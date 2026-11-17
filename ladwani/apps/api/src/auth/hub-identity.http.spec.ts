import { request as httpRequest } from 'http'
import type { AddressInfo } from 'net'
import { Controller, Get, Global, INestApplication, Module, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { hash } from 'bcryptjs'
import { AuthModule } from './auth.module'
import { PrismaService } from '../prisma/prisma.service'
import { HUB_AUDIT, HUB_ENTITY, HUB_REFUSAL_MESSAGE } from './auth.service'
import { HUB_HEADER, HUB_OTHER_SESSION, PROJECT_STATE_HEADER, encodeHubName, signHubIdentity } from './hub-identity'
import { ID_PROOF_ACTION } from './sign-up.service'
import { MAIL_TRANSPORT } from '../mail/mail-transport'
import { FakeMailTransport } from '../mail/fake-mail-transport'

/*
 * The bkesari hub's sign-in over real HTTP (docs/design/bkesari-id.md §3,
 * D-039): POST /auth/hub, X-Bkesari-Project-State on every answer, and only
 * the hub person's own session believed on their requests. The controllers,
 * guards, middleware and cookies as the hub serves them, against an in-memory
 * stand-in for the Prisma calls they make. No database, no network beyond loopback.
 */

type Row = Record<string, any>

/** Just enough of Prisma's `where`: equality, null, { in }, { gte }, OR. */
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c))
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(row[key])
      if ('gte' in cond) return row[key] >= cond.gte
    }
    return (row[key] ?? null) === (cond ?? null)
  })
}

let seq = 0
/** A table; `unique` columns refuse a second row with the same value (not null), as PostgreSQL does (P2002). */
function table(rows: Row[], decorate: (r: Row) => Row = (r) => r, defaults: () => Row = () => ({}), unique: string[] = []) {
  const pick = (where: Row) => rows.filter((r) => matches(r, where))
  const clash = (row: Row, self?: Row) => unique.some((k) => row[k] != null && rows.some((r) => r !== self && r[k] === row[k]))
  const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
  return {
    rows,
    create: async ({ data }: Row) => {
      const row = { id: `id-${++seq}`, createdAt: new Date(Date.now() + seq), ...defaults(), ...data }
      if (clash(row)) throw p2002()
      rows.push(row)
      return decorate(row)
    },
    findUnique: async ({ where }: Row) => (pick(where)[0] ? decorate(pick(where)[0]) : null),
    findFirst: async ({ where, orderBy }: Row) => {
      const found = pick(where)
      const [key, dir] = Object.entries(orderBy ?? {})[0] ?? []
      if (key) found.sort((a, b) => (dir === 'desc' ? b[key] - a[key] : a[key] - b[key]))
      return found[0] ? decorate(found[0]) : null
    },
    findMany: async ({ where }: Row = {}) => pick(where).map(decorate),
    count: async ({ where }: Row) => pick(where).length,
    update: async ({ where, data }: Row) => {
      const row = pick(where)[0]
      if (!row) throw new Error('not found')
      const next = { ...row, ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) }
      if (clash(next, row)) throw p2002()
      Object.assign(row, next)
      return decorate(row)
    },
    updateMany: async ({ where, data }: Row) => {
      const found = pick(where)
      found.forEach((r) => Object.assign(r, data))
      return { count: found.length }
    },
    delete: async ({ where }: Row) => {
      const i = rows.findIndex((r) => matches(r, where))
      return rows.splice(i, 1)[0]
    },
  }
}

function fakeDb() {
  const db: Row = {}
  db.role = table([{ id: 'r-member', code: 'MEMBER' }, { id: 'r-admin', code: 'ADMIN' }], undefined, undefined, ['code'])
  db.userRole = table([])
  db.member = table([], undefined, undefined, ['userId'])
  db.verificationToken = table([])
  db.refreshToken = table([])
  db.uploadedFile = table([])
  db.approval = table([], undefined, () => ({ submittedAt: new Date(Date.now() + seq) }))
  db.consentRecord = table([])
  db.approvalRule = table([])
  db.auditLog = table([])
  db.user = table(
    [],
    (u) => ({
      ...u,
      member: db.member.rows.find((m: Row) => m.userId === u.id) ?? null,
      userRoles: db.userRole.rows.filter((ur: Row) => ur.userId === u.id).map((ur: Row) => ({ ...ur, role: db.role.rows.find((r: Row) => r.id === ur.roleId) })),
    }),
    () => ({ hubUserId: null, deletedAt: null, emailVerified: false, mobileVerified: false, failedAttempts: 0, lockedUntil: null }),
    ['email', 'mobile', 'hubUserId'],
  )
  let queue: Promise<unknown> = Promise.resolve()
  db.$queryRaw = async () => []
  db.$transaction = async (arg: unknown) => {
    if (typeof arg !== 'function') return Promise.all(arg as Promise<unknown>[])
    const run = queue.then(() => (arg as (tx: Row) => unknown)(db))
    queue = run.catch(() => undefined)
    return run
  }
  return db
}

const SECRET = 'hub-proxy-secret-for-these-tests'

/** A route in another module, to show the middleware covers every API route, not only /auth. */
@Controller('elsewhere')
class ElsewhereController {
  @Get()
  get() {
    return { data: 'ok' }
  }
}
@Module({ controllers: [ElsewhereController] })
class ElsewhereModule {}

describe('The bkesari hub sign-in over HTTP', () => {
  let app: INestApplication
  let port: number
  let db: Row
  const savedEnv = { ...process.env }

  interface Reply {
    status: number
    body: any
    cookies: string[]
    state: string | undefined
  }

  function call(method: string, path: string, { body, headers = {} }: { body?: unknown; headers?: Record<string, string> } = {}): Promise<Reply> {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1', port, method, path: `/api/v1${path}`,
          headers: { ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}), ...headers },
        },
        (res) => {
          let text = ''
          res.on('data', (c) => (text += c))
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: text ? JSON.parse(text) : null,
              cookies: (res.headers['set-cookie'] as string[]) ?? [],
              state: res.headers[PROJECT_STATE_HEADER.toLowerCase()] as string | undefined,
            }),
          )
        },
      )
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }
  const sid = (r: Reply) => /lw_sid=([^;]*)/.exec(r.cookies.find((c) => c.startsWith('lw_sid=')) ?? '')?.[1] ?? ''

  /** The identity headers the hub adds, signed now (or as `over` says). */
  function hub(over: { user?: string; email?: string; role?: string; name?: string; project?: string; ts?: number; secret?: string } = {}) {
    const f = {
      project: over.project ?? 'ladwani',
      user: over.user ?? '101',
      email: over.email ?? 'asha@example.com',
      role: over.role ?? 'member',
      name: encodeHubName(over.name ?? 'Asha Devi Ladwani'),
      ts: over.ts ?? Math.floor(Date.now() / 1000),
    }
    return {
      [HUB_HEADER.user]: f.user,
      [HUB_HEADER.email]: f.email,
      [HUB_HEADER.role]: f.role,
      [HUB_HEADER.name]: f.name,
      [HUB_HEADER.project]: f.project,
      [HUB_HEADER.ts]: String(f.ts),
      [HUB_HEADER.sig]: signHubIdentity(f, over.secret ?? SECRET),
    }
  }

  const hubSignIn = (identity: Record<string, string> = hub(), headers: Record<string, string> = {}) =>
    call('POST', '/auth/hub', { body: {}, headers: { ...identity, ...headers } })

  async function addUser(over: Row = {}, roles: string[] = ['r-member']) {
    const user = await db.user.create({
      data: { email: 'asha@example.com', passwordHash: await hash('Correct1pass', 4), status: 'ACTIVE', emailVerified: true, ...over },
    })
    await db.member.create({ data: { userId: user.id, firstName: 'Asha', lastName: 'Ladwani' } })
    for (const roleId of roles) await db.userRole.create({ data: { userId: user.id, roleId } })
    return db.user.rows.find((u: Row) => u.id === user.id) as Row
  }
  const rolesOf = (userId: string) =>
    db.userRole.rows.filter((ur: Row) => ur.userId === userId).map((ur: Row) => db.role.rows.find((r: Row) => r.id === ur.roleId).code).sort()
  const liveSessions = (userId: string) => db.refreshToken.rows.filter((t: Row) => t.userId === userId && !t.revokedAt)
  const hubAudit = (action: string) => db.auditLog.rows.filter((r: Row) => r.action === action)
  const approveIdProof = (userId: string, status = 'APPROVED') =>
    db.approval.create({ data: { actionCode: ID_PROOF_ACTION, entityType: 'Member', submittedBy: userId, status } })

  beforeEach(async () => {
    process.env = { ...savedEnv, NODE_ENV: 'test', HUB_PROXY_SECRET: SECRET }
    delete process.env.LADWANI_HUB_PROXY_SECRET
    delete process.env.APP_ENV
    delete process.env.LADWANI_COOKIE_PATH
    delete process.env.COOKIE_PATH
    delete process.env.BUILTIN_ADMIN_PASSWORD_HASH
    delete process.env.LADWANI_VISITOR_HEADER
    delete process.env.VISITOR_HEADER
    db = fakeDb()
    db.role.rows.push({ id: 'r-karta', code: 'KARTA' }, { id: 'r-operator', code: 'OPERATOR' })

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: db }], exports: [PrismaService] })
    class FakePrismaModule {}

    const moduleRef = await Test.createTestingModule({ imports: [FakePrismaModule, AuthModule, ElsewhereModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(new FakeMailTransport())
      .compile()
    app = moduleRef.createNestApplication({ logger: false })
    app.use(cookieParser())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.setGlobalPrefix('api/v1')
    await app.listen(0, '127.0.0.1')
    port = (app.getHttpServer().address() as AddressInfo).port
  })

  afterEach(async () => {
    await app.close()
    process.env = { ...savedEnv }
  })

  describe('POST /auth/hub signs the hub person in without a password', () => {
    it('to the account already joined to their hub id', async () => {
      const asha = await addUser({ hubUserId: '101' })
      const r = await hubSignIn()
      expect(r.status).toBe(200)
      expect(r.body.data).toEqual({ accessToken: expect.any(String), user: { id: asha.id, roles: ['MEMBER'], memberId: expect.any(String) }, created: false })
      expect(sid(r)).not.toBe('')
      expect(liveSessions(asha.id)).toHaveLength(1)
      expect(asha.lastLoginAt).toEqual(expect.any(Date))
      const [row] = hubAudit(HUB_AUDIT.signedIn)
      expect(row).toMatchObject({ actorId: asha.id, actorRole: 'MEMBER', entityType: HUB_ENTITY, entityId: '101', newValue: { via: 'hub_user_id', hubRole: 'member' } })
    })

    it('to the account with the same CONFIRMED email, joining it to the hub id', async () => {
      const asha = await addUser({ email: 'asha@example.com', emailVerified: true })
      const r = await hubSignIn()
      expect(r.status).toBe(200)
      expect(r.body.data.user.id).toBe(asha.id)
      expect(asha.hubUserId).toBe('101')
      expect(db.user.rows).toHaveLength(1)
      expect(hubAudit(HUB_AUDIT.signedIn)[0].newValue).toMatchObject({ via: 'email' })
    })

    it('to a new ACTIVE, confirmed account with a member row and the MEMBER role when there is none', async () => {
      const r = await hubSignIn(hub({ name: 'Asha Devi Ladwani' }))
      expect(r.status).toBe(200)
      expect(r.body.data.created).toBe(true)
      expect(db.user.rows).toHaveLength(1)
      const [user] = db.user.rows
      expect(user).toMatchObject({ email: 'asha@example.com', hubUserId: '101', status: 'ACTIVE', emailVerified: true })
      expect(user.passwordHash).toMatch(/^\$2[aby]\$12\$/) // random, known to nobody
      expect(db.member.rows).toEqual([expect.objectContaining({ userId: user.id, firstName: 'Asha', lastName: 'Devi Ladwani' })])
      expect(rolesOf(user.id)).toEqual(['MEMBER'])
      expect(r.body.data.user).toEqual({ id: user.id, roles: ['MEMBER'], memberId: db.member.rows[0].id })
      expect(hubAudit(HUB_AUDIT.signedIn)[0].newValue).toMatchObject({ via: 'created' })

      // The next visit finds it by the hub id: nothing is made twice.
      const again = await hubSignIn(hub(), { cookie: `lw_sid=${sid(r)}` })
      expect(again.body.data).toMatchObject({ created: false, user: { id: user.id } })
      expect(db.user.rows).toHaveLength(1)
      expect(db.member.rows).toHaveLength(1)
      expect(rolesOf(user.id)).toEqual(['MEMBER'])
    })

    it('makes one account when two first visits arrive at once (two tabs)', async () => {
      const [a, b] = await Promise.all([hubSignIn(), hubSignIn()])
      expect([a.status, b.status]).toEqual([200, 200])
      expect(db.user.rows).toHaveLength(1)
      expect(a.body.data.user.id).toBe(b.body.data.user.id)
      expect(db.member.rows).toHaveLength(1)
    })

    it("names a new member from the email's local part when the hub has no name", async () => {
      await hubSignIn(hub({ name: '', email: 'asha.l@example.com' }))
      expect(db.member.rows[0]).toMatchObject({ firstName: 'asha.l', lastName: null })
    })

    it('is refused cross-site, like every /auth route', async () => {
      const r = await hubSignIn(hub(), { origin: 'https://evil.example', host: 'bkesari.com' })
      expect(r.status).toBe(403)
      expect(db.user.rows).toHaveLength(0)
    })
  })

  describe('ignores the headers entirely, and LadWani sign-in works as before', () => {
    it.each([
      ['HUB_PROXY_SECRET is not set here', () => { delete process.env.HUB_PROXY_SECRET; return hub() }],
      ['the signature is not the hub key', () => hub({ secret: 'not-the-hub-secret' })],
      ['the identity is for another project', () => hub({ project: 'edu' })],
      ['the time stamp is a minute old', () => hub({ ts: Math.floor(Date.now() / 1000) - 60 })],
      ['the time stamp is a minute ahead', () => hub({ ts: Math.floor(Date.now() / 1000) + 61 })],
      ['a header is missing', () => { const h: Record<string, string> = hub(); delete h[HUB_HEADER.sig]; return h }],
      ['a field was changed after signing', () => ({ ...hub(), [HUB_HEADER.role]: 'admin' })],
    ])('when %s', async (_why, identity) => {
      await addUser({ hubUserId: '101' })
      const r = await hubSignIn(identity())
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ data: null })
      expect(sid(r)).toBe('')
      expect(r.state).toBeUndefined()
      expect(db.refreshToken.rows).toHaveLength(0)
      expect(db.auditLog.rows).toHaveLength(0)
      // LadWani's own sign-in still works.
      const own = await call('POST', '/auth/login', { body: { identifier: 'asha@example.com', password: 'Correct1pass' }, headers: identity() })
      expect(own.status).toBe(200)
    })
  })

  describe('refuses, and joins or makes nothing', () => {
    it('an email LadWani never confirmed: 409, the account is not joined and no new one is made (D-035)', async () => {
      // Someone registered with this address and a password of their own, and never proved the inbox.
      const squatter = await addUser({ email: 'asha@example.com', emailVerified: false, status: 'PENDING' })
      const r = await hubSignIn()
      expect(r.status).toBe(409)
      expect(r.body).toMatchObject({ reason: 'HUB_EMAIL_UNCONFIRMED', message: HUB_REFUSAL_MESSAGE.HUB_EMAIL_UNCONFIRMED })
      expect(squatter.hubUserId).toBeNull()
      expect(db.user.rows).toHaveLength(1)
      expect(db.member.rows).toHaveLength(1)
      expect(sid(r)).toBe('')
      expect(liveSessions(squatter.id)).toHaveLength(0)
      expect(hubAudit(HUB_AUDIT.refused)[0]).toMatchObject({ actorId: 'anonymous', entityId: '101', newValue: { reason: 'HUB_EMAIL_UNCONFIRMED', email: 'asha@example.com' } })
    })

    it('then joins it once a LadWani email code has confirmed the address', async () => {
      const asha = await addUser({ email: 'asha@example.com', emailVerified: false })
      expect((await hubSignIn()).status).toBe(409)
      asha.emailVerified = true // what /auth/otp/login does with the right code
      const r = await hubSignIn()
      expect(r.status).toBe(200)
      expect(asha.hubUserId).toBe('101')
    })

    it('an email whose account is joined to another bkesari ID: 409', async () => {
      const other = await addUser({ hubUserId: '555' })
      const r = await hubSignIn()
      expect(r.status).toBe(409)
      expect(r.body.reason).toBe('HUB_EMAIL_TAKEN')
      expect(other.hubUserId).toBe('555')
      expect(db.user.rows).toHaveLength(1)
    })

    it.each(['SUSPENDED', 'BLOCKED'])('a %s account: 403, no session', async (status) => {
      const asha = await addUser({ hubUserId: '101', status })
      const r = await hubSignIn()
      expect(r.status).toBe(403)
      expect(r.body.reason).toBe('SUSPENDED')
      expect(liveSessions(asha.id)).toHaveLength(0)
      expect(rolesOf(asha.id)).toEqual(['MEMBER'])
    })

    it('a suspended account found by its confirmed email: 403, and it is not joined', async () => {
      const asha = await addUser({ status: 'SUSPENDED' })
      expect((await hubSignIn()).status).toBe(403)
      expect(asha.hubUserId).toBeNull()
    })

    it('a removed account: 403', async () => {
      await addUser({ hubUserId: '101', deletedAt: new Date() })
      const r = await hubSignIn()
      expect(r.status).toBe(403)
      expect(r.body.reason).toBe('REMOVED')
    })

    it('an address on the reserved domain that is no built-in administrator: 403', async () => {
      const r = await hubSignIn(hub({ email: 'someone@builtin.bkesari.com', role: 'admin' }))
      expect(r.status).toBe(403)
      expect(r.body.reason).toBe('RESERVED_EMAIL')
      expect(db.user.rows).toHaveLength(0)
    })
  })

  describe("maps the hub's role, adding and never removing", () => {
    it.each([
      ['member', ['MEMBER']],
      ['karta', ['KARTA', 'MEMBER']],
      ['operator', ['MEMBER', 'OPERATOR']],
      ['admin', ['ADMIN', 'MEMBER']],
    ])('%s -> %j', async (role, codes) => {
      const r = await hubSignIn(hub({ role }))
      expect(r.status).toBe(200)
      const userId = r.body.data.user.id
      expect(rolesOf(userId)).toEqual(codes)
      expect([...r.body.data.user.roles].sort()).toEqual(codes)
      // A second sign-in adds nothing twice.
      await hubSignIn(hub({ role }))
      expect(rolesOf(userId)).toEqual(codes)
    })

    it("keeps the roles given inside LadWani when the hub's role is lower", async () => {
      const asha = await addUser({ hubUserId: '101' }, ['r-member', 'r-admin'])
      const r = await hubSignIn(hub({ role: 'member' }))
      expect(r.status).toBe(200)
      expect(rolesOf(asha.id)).toEqual(['ADMIN', 'MEMBER'])
    })

    it('records the roles it added', async () => {
      await addUser({ hubUserId: '101' })
      await hubSignIn(hub({ role: 'operator' }))
      expect(hubAudit(HUB_AUDIT.signedIn)[0]).toMatchObject({ actorRole: 'OPERATOR', newValue: { rolesAdded: ['OPERATOR'] } })
    })

    it('makes a role row the seed has not made yet', async () => {
      db.role.rows.splice(db.role.rows.findIndex((r: Row) => r.code === 'OPERATOR'), 1)
      const r = await hubSignIn(hub({ role: 'operator' }))
      expect(rolesOf(r.body.data.user.id)).toEqual(['MEMBER', 'OPERATOR'])
      expect(db.role.rows.find((x: Row) => x.code === 'OPERATOR')).toMatchObject({ label: 'Operator', isSystem: true })
    })
  })

  describe("the hub's built-in administrators (role admin, <name>@builtin.bkesari.com)", () => {
    const smorankar = () => hub({ user: '1', email: 'smorankar@builtin.bkesari.com', role: 'admin', name: 'S Morankar' })

    it("sign in to LadWani's built-in account for that username, made as builtin-admins.ts makes it", async () => {
      const r = await hubSignIn(smorankar())
      expect(r.status).toBe(200)
      const [user] = db.user.rows
      expect(user).toMatchObject({ email: 'smorankar@builtin.bkesari.com', hubUserId: '1', status: 'ACTIVE', emailVerified: true })
      expect(db.member.rows[0]).toMatchObject({ userId: user.id, firstName: 'smorankar' })
      expect(rolesOf(user.id)).toEqual(['ADMIN', 'MEMBER'])
      expect(r.body.data.created).toBe(false)
      expect(hubAudit(HUB_AUDIT.signedIn)[0]).toMatchObject({ actorRole: 'ADMIN', newValue: { via: 'builtin' } })
    })

    it('reuse the existing built-in account and join it to the hub id', async () => {
      const existing = await addUser({ email: 'smorankar@builtin.bkesari.com' }, ['r-admin'])
      const r = await hubSignIn(smorankar())
      expect(r.body.data.user.id).toBe(existing.id)
      expect(existing.hubUserId).toBe('1')
      expect(db.user.rows).toHaveLength(1)
    })

    it("never open a built-in account for another hub id's address", async () => {
      await addUser({ email: 'smorankar@builtin.bkesari.com', hubUserId: '1' }, ['r-admin'])
      const r = await hubSignIn(hub({ user: '1', email: 'eve@example.com', role: 'member' }))
      expect(r.status).toBe(409)
      expect(r.body.reason).toBe('HUB_ID_TAKEN')
    })
  })

  describe("this browser's session", () => {
    it("of another person ends first; the hub person's starts", async () => {
      const other = await addUser({ email: 'ravi@example.com', hubUserId: '202' })
      const login = await call('POST', '/auth/login', { body: { identifier: 'ravi@example.com', password: 'Correct1pass' } })
      expect(liveSessions(other.id)).toHaveLength(1)
      const r = await hubSignIn(hub(), { cookie: `lw_sid=${sid(login)}` })
      expect(r.status).toBe(200)
      expect(r.body.data.user.id).not.toBe(other.id)
      expect(liveSessions(other.id)).toHaveLength(0)
      expect(sid(r)).not.toBe(sid(login))
      expect(hubAudit(HUB_AUDIT.signedIn)[0].newValue).toMatchObject({ endedOtherSession: true })
    })

    it("of the same person is renewed, and a renewal alone writes no audit row", async () => {
      const asha = await addUser({ hubUserId: '101' })
      const first = await hubSignIn()
      const second = await hubSignIn(hub(), { cookie: `lw_sid=${sid(first)}` })
      expect(second.status).toBe(200)
      expect(sid(second)).not.toBe(sid(first))
      expect(liveSessions(asha.id)).toHaveLength(1)
      expect(hubAudit(HUB_AUDIT.signedIn)).toHaveLength(1)
    })

    it('ends, and its cookie is cleared, when the hub sign-in is refused', async () => {
      const ravi = await addUser({ email: 'ravi@example.com' })
      const login = await call('POST', '/auth/login', { body: { identifier: 'ravi@example.com', password: 'Correct1pass' } })
      await addUser({ email: 'asha@example.com', emailVerified: false })
      const r = await hubSignIn(hub(), { cookie: `lw_sid=${sid(login)}` })
      expect(r.status).toBe(409)
      expect(liveSessions(ravi.id)).toHaveLength(0)
      expect(r.cookies.find((c) => c.startsWith('lw_sid='))).toMatch(/^lw_sid=;/)
      expect(hubAudit(HUB_AUDIT.refused)[0].newValue).toMatchObject({ endedSession: true })
    })
  })

  describe('only the hub person can use LadWani on their requests', () => {
    it("refuses another person's access token (401), and takes their own", async () => {
      await addUser({ email: 'ravi@example.com', hubUserId: '202' })
      const ravi = await call('POST', '/auth/login', { body: { identifier: 'ravi@example.com', password: 'Correct1pass' } })
      const asha = await hubSignIn()
      const asRavi = await call('GET', '/auth/sign-up/status', { headers: { ...hub(), authorization: `Bearer ${ravi.body.data.accessToken}` } })
      expect(asRavi.status).toBe(401)
      expect(asRavi.body.message).toBe(HUB_OTHER_SESSION)
      const asAsha = await call('GET', '/auth/sign-up/status', { headers: { ...hub(), authorization: `Bearer ${asha.body.data.accessToken}` } })
      expect(asAsha.status).toBe(200)
      // Without the hub's identity, LadWani's own sessions work as before.
      expect((await call('GET', '/auth/sign-up/status', { headers: { authorization: `Bearer ${ravi.body.data.accessToken}` } })).status).toBe(200)
    })

    it("refuses any access token while the hub person has no LadWani account yet", async () => {
      await addUser({ email: 'ravi@example.com' })
      const ravi = await call('POST', '/auth/login', { body: { identifier: 'ravi@example.com', password: 'Correct1pass' } })
      const r = await call('GET', '/auth/sign-up/status', { headers: { ...hub({ email: 'new@example.com' }), authorization: `Bearer ${ravi.body.data.accessToken}` } })
      expect(r.status).toBe(401)
    })

    it("ends another person's session on /auth/refresh instead of renewing it", async () => {
      const ravi = await addUser({ email: 'ravi@example.com', hubUserId: '202' })
      const login = await call('POST', '/auth/login', { body: { identifier: 'ravi@example.com', password: 'Correct1pass' } })
      const r = await call('POST', '/auth/refresh', { body: {}, headers: { ...hub(), cookie: `lw_sid=${sid(login)}` } })
      expect(r.status).toBe(401)
      expect(r.body.message).toBe(HUB_OTHER_SESSION)
      expect(liveSessions(ravi.id)).toHaveLength(0)
      expect(r.cookies.find((c) => c.startsWith('lw_sid='))).toMatch(/^lw_sid=;/)
    })

    it('renews the hub person\'s own session on /auth/refresh', async () => {
      await addUser({ hubUserId: '101' })
      const first = await hubSignIn()
      const r = await call('POST', '/auth/refresh', { body: {}, headers: { ...hub(), cookie: `lw_sid=${sid(first)}` } })
      expect(r.status).toBe(200)
    })

    it("shows another person's session as none on GET /auth/session", async () => {
      await addUser({ email: 'ravi@example.com', hubUserId: '202' })
      const login = await call('POST', '/auth/login', { body: { identifier: 'ravi@example.com', password: 'Correct1pass' } })
      const r = await call('GET', '/auth/session', { headers: { ...hub(), cookie: `lw_sid=${sid(login)}` } })
      expect(r.body.user).toBeNull()
      const own = await call('GET', '/auth/session', { headers: { cookie: `lw_sid=${sid(login)}` } })
      expect(own.body.user).toMatchObject({ email: 'ravi@example.com' })
    })
  })

  describe('X-Bkesari-Project-State', () => {
    it('is pending for a hub person with no LadWani account yet, on any answer', async () => {
      expect((await call('GET', '/auth/session', { headers: hub() })).state).toBe('pending')
      // Errors too: here the JWT guard's 401.
      expect((await call('GET', '/auth/sign-up/status', { headers: hub() })).state).toBe('pending')
    })

    it('is pending until the ID proof is approved, then verified', async () => {
      const asha = await addUser({ hubUserId: '101' })
      const r = await hubSignIn()
      expect(r.state).toBe('pending')
      const auth = { ...hub(), authorization: `Bearer ${r.body.data.accessToken}` }

      await approveIdProof(asha.id, 'SUBMITTED')
      expect((await call('GET', '/auth/sign-up/status', { headers: auth })).state).toBe('pending')
      db.approval.rows[0].status = 'RETURNED'
      expect((await call('GET', '/auth/sign-up/status', { headers: auth })).state).toBe('pending')
      db.approval.rows[0].status = 'APPROVED'
      const verified = await call('GET', '/auth/sign-up/status', { headers: auth })
      expect(verified.state).toBe('verified')
      expect(verified.body.data.idProof.state).toBe('VERIFIED')

      // A newer ID proof waiting for review makes it pending again, as the person's own status page says.
      await approveIdProof(asha.id, 'SUBMITTED')
      expect((await call('GET', '/auth/sign-up/status', { headers: auth })).state).toBe('pending')
    })

    it('is verified on the /auth/hub answer that joins an already verified account', async () => {
      const asha = await addUser()
      await approveIdProof(asha.id)
      const r = await hubSignIn()
      expect(r.status).toBe(200)
      expect(r.state).toBe('verified')
    })

    it.each(['operator', 'admin'])('is verified for LadWani staff (hub role %s)', async (role) => {
      expect((await hubSignIn(hub({ role }))).state).toBe('verified')
    })

    it('is pending for a suspended account, even with an approved ID proof', async () => {
      const asha = await addUser({ hubUserId: '101', status: 'SUSPENDED' })
      await approveIdProof(asha.id)
      expect((await call('GET', '/auth/session', { headers: hub() })).state).toBe('pending')
    })

    it('is on routes outside /auth too', async () => {
      await addUser({ hubUserId: '101' }, ['r-member', 'r-operator'])
      const r = await call('GET', '/elsewhere', { headers: hub() })
      expect(r.status).toBe(200)
      expect(r.state).toBe('verified')
      expect((await call('GET', '/elsewhere')).state).toBeUndefined()
    })

    it('is never sent without a valid identity', async () => {
      const asha = await addUser({ hubUserId: '101' })
      await approveIdProof(asha.id)
      expect((await call('GET', '/auth/session')).state).toBeUndefined()
      expect((await call('GET', '/auth/session', { headers: hub({ secret: 'wrong' }) })).state).toBeUndefined()
    })
  })
})
