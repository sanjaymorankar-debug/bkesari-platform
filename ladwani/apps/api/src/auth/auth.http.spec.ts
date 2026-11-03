import { request as httpRequest } from 'http'
import type { AddressInfo } from 'net'
import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { hash } from 'bcryptjs'
import { AuthModule } from './auth.module'
import { PrismaService } from '../prisma/prisma.service'
import { OTP_MAX_TRIES, OTP_SENDS_PER_HOUR } from './auth.service'

/*
 * LadWani's sign-in over real HTTP: the controllers, guards, validation pipe
 * and cookies as the hub serves them, against an in-memory stand-in for the
 * few Prisma calls auth makes. No database, no network beyond loopback.
 */

type Row = Record<string, any>

/** Just enough of Prisma's `where` for these queries: equality, null, { in }, { gte }, OR. */
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
function table(rows: Row[], decorate: (r: Row) => Row = (r) => r, defaults: () => Row = () => ({})) {
  const pick = (where: Row) => rows.filter((r) => matches(r, where))
  return {
    rows,
    create: async ({ data }: Row) => {
      const row = { id: `id-${++seq}`, createdAt: new Date(Date.now() + seq), ...defaults(), ...data }
      rows.push(row)
      return decorate(row)
    },
    findUnique: async ({ where }: Row) => (pick(where)[0] ? decorate(pick(where)[0]) : null),
    findFirst: async ({ where, orderBy }: Row) => {
      const found = pick(where)
      if (orderBy?.createdAt === 'desc') found.sort((a, b) => b.createdAt - a.createdAt)
      return found[0] ? decorate(found[0]) : null
    },
    count: async ({ where }: Row) => pick(where).length,
    update: async ({ where, data }: Row) => {
      const row = pick(where)[0]
      if (!row) throw new Error('not found')
      Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)))
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
  db.role = table([{ id: 'r-member', code: 'MEMBER' }])
  db.userRole = table([])
  db.member = table([])
  db.verificationToken = table([])
  db.refreshToken = table([])
  db.uploadedFile = table([])
  db.approval = table([], undefined, () => ({ submittedAt: new Date() }))
  db.consentRecord = table([])
  db.approvalRule = table([])
  db.user = table([], (u) => ({
    ...u,
    member: db.member.rows.find((m: Row) => m.userId === u.id) ?? null,
    userRoles: db.userRole.rows.filter((ur: Row) => ur.userId === u.id).map((ur: Row) => ({ role: db.role.rows.find((r: Row) => r.id === ur.roleId) })),
  }))
  db.$transaction = async (arg: unknown) => (typeof arg === 'function' ? arg(db) : Promise.all(arg as Promise<unknown>[]))
  return db
}

async function addUser(db: Row, over: Row = {}) {
  const user = await db.user.create({
    data: {
      email: 'asha@example.com', mobile: '9876543210', passwordHash: await hash('Correct1pass', 4), status: 'ACTIVE',
      failedAttempts: 0, lockedUntil: null, deletedAt: null, mobileVerified: true, ...over,
    },
  })
  await db.member.create({ data: { userId: user.id, firstName: 'Asha', lastName: 'Ladwani' } })
  await db.userRole.create({ data: { userId: user.id, roleId: 'r-member' } })
  return db.user.rows.find((u: Row) => u.id === user.id) as Row
}

interface Reply { status: number; body: any; cookies: string[] }

describe('LadWani auth over HTTP', () => {
  let app: INestApplication
  let port: number
  let db: Row
  const savedEnv = { ...process.env }

  /** One request, with whatever Host/Origin/Cookie headers the case needs. */
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
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null, cookies: (res.headers['set-cookie'] as string[]) ?? [] }))
        },
      )
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }
  const sid = (r: Reply) => /lw_sid=([^;]*)/.exec(r.cookies.find((c) => c.startsWith('lw_sid=')) ?? '')?.[1] ?? ''

  beforeEach(async () => {
    process.env = { ...savedEnv, NODE_ENV: 'test' }
    delete process.env.LADWANI_HUB_JWKS
    delete process.env.HUB_JWKS_URL
    delete process.env.LADWANI_COOKIE_PATH
    delete process.env.COOKIE_PATH
    db = fakeDb()

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: db }], exports: [PrismaService] })
    class FakePrismaModule {}

    const moduleRef = await Test.createTestingModule({ imports: [FakePrismaModule, AuthModule] }).compile()
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

  describe('the hub sign-in is gone', () => {
    it('starts without LADWANI_HUB_JWKS and has no POST /auth/hub', async () => {
      expect((await call('POST', '/auth/hub', { headers: { 'x-bkesari-token': 'a.b.c' } })).status).toBe(404)
    })
  })

  describe('the session cookie', () => {
    it('is lw_sid: HttpOnly, SameSite=Lax, Path=/ladwani, Secure on a real host', async () => {
      await addUser(db)
      const r = await call('POST', '/auth/login', { body: { identifier: 'asha@example.com', password: 'Correct1pass' }, headers: { host: 'dev.bkesari.com' } })
      expect(r.status).toBe(200)
      const cookie = r.cookies.find((c) => c.startsWith('lw_sid='))!
      expect(cookie).toMatch(/; Path=\/ladwani(;|$)/)
      expect(cookie).toMatch(/; HttpOnly/)
      expect(cookie).toMatch(/; Secure/)
      expect(cookie).toMatch(/; SameSite=Lax/)
      expect(cookie).toMatch(/; Max-Age=2592000/)
      expect(r.body.data.accessToken).toEqual(expect.any(String))
      expect(r.cookies.some((c) => c.startsWith('refreshToken='))).toBe(false)
    })

    it('drops Secure only for plain http to localhost', async () => {
      await addUser(db)
      const r = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' }, headers: { host: 'localhost:4000' } })
      expect(r.cookies.find((c) => c.startsWith('lw_sid='))).not.toMatch(/Secure/)
    })

    it('takes its path from LADWANI_COOKIE_PATH', async () => {
      process.env.LADWANI_COOKIE_PATH = '/'
      await addUser(db)
      const r = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' }, headers: { host: 'localhost' } })
      expect(r.cookies.find((c) => c.startsWith('lw_sid='))).toMatch(/; Path=\/(;|$)/)
    })

    it('logout revokes the session and clears the cookie on the same path', async () => {
      await addUser(db)
      const login = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' }, headers: { host: 'bkesari.com' } })
      const out = await call('POST', '/auth/logout', { body: {}, headers: { host: 'bkesari.com', origin: 'https://bkesari.com', cookie: `lw_sid=${sid(login)}` } })
      expect(out.status).toBe(200)
      expect(out.cookies.find((c) => c.startsWith('lw_sid='))).toMatch(/^lw_sid=; Path=\/ladwani; Expires=Thu, 01 Jan 1970/)
      expect(db.refreshToken.rows.every((t: Row) => t.revokedAt)).toBe(true)
      expect((await call('POST', '/auth/refresh', { headers: { cookie: `lw_sid=${sid(login)}` } })).status).toBe(401)
    })

    it('refresh rotates the cookie; the old one stops working', async () => {
      await addUser(db)
      const login = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' } })
      const first = await call('POST', '/auth/refresh', { headers: { cookie: `lw_sid=${sid(login)}` } })
      expect(first.status).toBe(200)
      expect(sid(first)).not.toBe(sid(login))
      expect((await call('POST', '/auth/refresh', { headers: { cookie: `lw_sid=${sid(login)}` } })).status).toBe(401)
    })
  })

  describe('cross-site requests', () => {
    it('are refused on refresh, logout and session', async () => {
      await addUser(db)
      const login = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' }, headers: { host: 'bkesari.com' } })
      const cookie = `lw_sid=${sid(login)}`
      const evil = { host: 'bkesari.com', origin: 'https://evil.example', cookie }
      expect((await call('POST', '/auth/refresh', { headers: evil })).status).toBe(403)
      expect((await call('POST', '/auth/logout', { body: {}, headers: evil })).status).toBe(403)
      expect((await call('GET', '/auth/session', { headers: { host: 'bkesari.com', 'sec-fetch-site': 'cross-site', cookie } })).status).toBe(403)
      expect(db.refreshToken.rows.filter((t: Row) => !t.revokedAt)).toHaveLength(1)
    })

    it('pass when Origin names this host, or when the browser says same-origin', async () => {
      await addUser(db)
      const login = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' }, headers: { host: 'bkesari.com' } })
      const r = await call('POST', '/auth/refresh', { headers: { host: 'bkesari.com', origin: 'https://bkesari.com', 'sec-fetch-site': 'same-origin', cookie: `lw_sid=${sid(login)}` } })
      expect(r.status).toBe(200)
    })
  })

  describe('GET /auth/session (the app shell)', () => {
    it('answers 401 with where to sign in when there is no session', async () => {
      const r = await call('GET', '/auth/session')
      expect(r.status).toBe(401)
      expect(r.body).toEqual({ user: null, signInUrl: '/ladwani/sign-in/' })
    })

    it('names the member, links the profile, and does not rotate the cookie', async () => {
      await addUser(db)
      const login = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' } })
      const r = await call('GET', '/auth/session', { headers: { cookie: `lw_sid=${sid(login)}; k_lang=mr` } })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({
        user: { name: 'Asha Ladwani', email: 'asha@example.com', mobile: '9876543210' },
        signOut: { url: '/ladwani/api/v1/auth/logout', next: '/ladwani/sign-in' },
        links: [{ label: 'माझी प्रोफाइल', href: '/ladwani/profile/edit/' }],
      })
      expect(r.cookies).toEqual([])
      expect(db.refreshToken.rows.filter((t: Row) => !t.revokedAt)).toHaveLength(1)
    })
  })

  describe('password lockout', () => {
    it('locks after 5 wrong passwords, for 15 minutes, even for the right one', async () => {
      await addUser(db)
      const wrong = () => call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Wrong1pass' } })
      for (let i = 1; i <= 4; i++) expect((await wrong()).status).toBe(401)
      const fifth = await wrong()
      expect(fifth.status).toBe(403)
      expect(fifth.body.message).toMatch(/Try again in 15 minutes/)
      const right = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' } })
      expect(right.status).toBe(403)
    })
  })

  describe('mobile + OTP sign-in', () => {
    it('answers the same for a registered and an unknown number, and never shows the code in production', async () => {
      await addUser(db)
      process.env.NODE_ENV = 'production'
      const known = await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } })
      const unknown = await call('POST', '/auth/otp/send', { body: { mobile: '9123456780' } })
      expect(known.status).toBe(200)
      expect(known.body).toEqual(unknown.body)
      expect(JSON.stringify(known.body)).not.toMatch(/devOtp|\b\d{6}\b/)
      // The code was still issued, hashed: never stored as typed.
      const code = db.verificationToken.rows.find((t: Row) => t.type === 'MOBILE_LOGIN')
      expect(code.tokenHash).toMatch(/^\$2[aby]\$/)
    })

    it('signs in with the code (devOtp outside production) and sets the cookie', async () => {
      await addUser(db)
      const sent = await call('POST', '/auth/otp/send', { body: { mobile: '+91 98765 43210' } })
      expect(sent.body.devOtp).toMatch(/^\d{6}$/)
      const r = await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: sent.body.devOtp } })
      expect(r.status).toBe(200)
      expect(r.body.data.user.roles).toEqual(['MEMBER'])
      expect(sid(r)).toMatch(/^[0-9a-f]{96}$/)
      // Single use.
      expect((await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: sent.body.devOtp } })).status).toBe(401)
    })

    it('verifies and activates an account that registered but never entered its code', async () => {
      const reg = await call('POST', '/auth/register', { body: { firstName: 'Ravi', lastName: 'Patil', mobile: '9988776655' } })
      expect(reg.status).toBe(201)
      const user = db.user.rows[0]
      expect(user.status).toBe('PENDING')
      const r = await call('POST', '/auth/otp/login', { body: { mobile: '9988776655', otp: reg.body.devOtp } })
      expect(r.status).toBe(200)
      expect(user).toMatchObject({ status: 'ACTIVE', mobileVerified: true })
    })

    it('voids a code after 5 wrong tries', async () => {
      await addUser(db)
      const sent = await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } })
      const wrongCode = sent.body.devOtp === '000000' ? '111111' : '000000'
      const replies = []
      for (let i = 0; i < OTP_MAX_TRIES; i++) replies.push(await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: wrongCode } }))
      expect(replies.map((r) => r.status)).toEqual(Array(OTP_MAX_TRIES).fill(401))
      expect(replies[OTP_MAX_TRIES - 1].body.message).toMatch(/Too many wrong codes/)
      expect((await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: sent.body.devOtp } })).status).toBe(401)
    })

    it(`sends at most ${OTP_SENDS_PER_HOUR} codes an hour to one account, answering the same`, async () => {
      await addUser(db)
      const replies = []
      for (let i = 0; i < OTP_SENDS_PER_HOUR + 1; i++) replies.push(await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } }))
      expect(replies.map((r) => r.status)).toEqual(Array(OTP_SENDS_PER_HOUR + 1).fill(200))
      expect(replies[OTP_SENDS_PER_HOUR].body.devOtp).toBeUndefined()
      expect(db.verificationToken.rows.filter((t: Row) => t.type === 'MOBILE_LOGIN')).toHaveLength(OTP_SENDS_PER_HOUR)
      // Only the newest code works.
      expect((await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: replies[0].body.devOtp } })).status).toBe(401)
    })

    it('still works while the password is locked, and clears the lock', async () => {
      const user = await addUser(db, { failedAttempts: 5, lockedUntil: new Date(Date.now() + 10 * 60_000) })
      const sent = await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } })
      expect((await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: sent.body.devOtp } })).status).toBe(200)
      expect(user).toMatchObject({ failedAttempts: 0, lockedUntil: null })
    })

    it('refuses a suspended account and sends it nothing', async () => {
      await addUser(db, { status: 'SUSPENDED' })
      const sent = await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } })
      expect(sent.status).toBe(200)
      expect(sent.body.devOtp).toBeUndefined()
    })

    it('rejects a malformed number or code before looking anything up', async () => {
      expect((await call('POST', '/auth/otp/send', { body: { mobile: '12345' } })).status).toBe(400)
      expect((await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: '12ab56' } })).status).toBe(400)
    })
  })

  describe('forgot password by OTP', () => {
    it('answers the same whether or not the account exists (production)', async () => {
      await addUser(db)
      process.env.NODE_ENV = 'production'
      const known = await call('POST', '/auth/password/forgot', { body: { identifier: 'Asha@Example.com' } })
      const unknown = await call('POST', '/auth/password/forgot', { body: { identifier: 'nobody@example.com' } })
      expect(known.status).toBe(200)
      expect(known.body).toEqual(unknown.body)
      expect(known.body.devOtp).toBeUndefined()
    })

    it('resets with the code: new password works, lock cleared, every session ended', async () => {
      const user = await addUser(db, { failedAttempts: 5, lockedUntil: new Date(Date.now() + 10 * 60_000) })
      // A session from before, e.g. on a phone that was lost.
      const before = await call('POST', '/auth/otp/login', {
        body: { mobile: '9876543210', otp: (await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } })).body.devOtp },
      })
      const sent = await call('POST', '/auth/password/forgot', { body: { identifier: '9876543210' } })
      const bad = await call('POST', '/auth/password/reset', { body: { identifier: '9876543210', otp: sent.body.devOtp === '000000' ? '111111' : '000000', password: 'NewPass123' } })
      expect(bad.status).toBe(400)
      const weak = await call('POST', '/auth/password/reset', { body: { identifier: '9876543210', otp: sent.body.devOtp, password: 'short' } })
      expect(weak.status).toBe(400)

      const ok = await call('POST', '/auth/password/reset', { body: { identifier: '9876543210', otp: sent.body.devOtp, password: 'NewPass123' } })
      expect(ok.status).toBe(200)
      expect(ok.body.data).toEqual({ reset: true })
      expect(user).toMatchObject({ failedAttempts: 0, lockedUntil: null })
      expect(db.refreshToken.rows.every((t: Row) => t.revokedAt)).toBe(true)
      expect((await call('POST', '/auth/refresh', { headers: { cookie: `lw_sid=${sid(before)}` } })).status).toBe(401)
      expect((await call('POST', '/auth/login', { body: { identifier: 'asha@example.com', password: 'NewPass123' } })).status).toBe(200)
    })

    it('does not accept a sign-in code as a reset code', async () => {
      await addUser(db)
      const sent = await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } })
      const r = await call('POST', '/auth/password/reset', { body: { identifier: '9876543210', otp: sent.body.devOtp, password: 'NewPass123' } })
      expect(r.status).toBe(400)
    })
  })

  describe('sign-up', () => {
    it('can start without a password: the account signs in with its code', async () => {
      const reg = await call('POST', '/auth/register', { body: { firstName: 'Meera', lastName: 'Joshi', mobile: '098765 43211' } })
      expect(reg.status).toBe(201)
      expect(db.user.rows[0].mobile).toBe('9876543211')
      expect(db.user.rows[0].passwordHash).toMatch(/^\$2[aby]\$/)
    })

    it('step 4 sends the ID proof to review and the status never names a reviewer', async () => {
      const user = await addUser(db)
      const login = await call('POST', '/auth/login', { body: { identifier: '9876543210', password: 'Correct1pass' } })
      const auth = { authorization: `Bearer ${login.body.data.accessToken}` }
      expect((await call('GET', '/auth/sign-up/status', { headers: auth })).body.data.idProof.state).toBe('NOT_SUBMITTED')

      const file = await db.uploadedFile.create({ data: { uploaderId: user.id, purpose: 'DOCUMENT', status: 'ACTIVE' } })
      const noConsent = await call('POST', '/auth/sign-up/complete', { body: { idProofFileId: file.id, selfDeclaration: true, dataConsent: false }, headers: auth })
      expect(noConsent.status).toBe(400)
      const someoneElses = await db.uploadedFile.create({ data: { uploaderId: 'other', purpose: 'DOCUMENT', status: 'ACTIVE' } })
      expect((await call('POST', '/auth/sign-up/complete', { body: { idProofFileId: someoneElses.id, selfDeclaration: true, dataConsent: true }, headers: auth })).status).toBe(400)

      const done = await call('POST', '/auth/sign-up/complete', { body: { idProofFileId: file.id, selfDeclaration: true, dataConsent: true }, headers: auth })
      expect(done.status).toBe(200)
      expect(done.body.data.idProof.state).toBe('UNDER_REVIEW')
      expect(db.approval.rows[0]).toMatchObject({ actionCode: 'member.id_proof.verify', submittedBy: user.id, status: 'SUBMITTED' })
      expect(db.consentRecord.rows.map((c: Row) => c.consentType).sort()).toEqual(['ID_PROOF_DECLARATION', 'PROFILE_STORAGE'])

      Object.assign(db.approval.rows[0], { status: 'APPROVED', reviewedBy: 'operator-7', reviewNote: 'ok' })
      const status = await call('GET', '/auth/sign-up/status', { headers: auth })
      expect(status.body.data.idProof).toEqual({ state: 'VERIFIED', submittedAt: expect.any(String), note: null })
      expect(JSON.stringify(status.body)).not.toMatch(/operator-7|reviewedBy/)
    })

    it('needs a signed-in member', async () => {
      expect((await call('GET', '/auth/sign-up/status')).status).toBe(401)
    })
  })
})
