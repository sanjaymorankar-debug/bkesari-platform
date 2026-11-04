import { request as httpRequest } from 'http'
import type { AddressInfo } from 'net'
import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import cookieParser from 'cookie-parser'
import { hash } from 'bcryptjs'
import { AuthModule } from './auth.module'
import { PrismaService } from '../prisma/prisma.service'
import { AuthService, OTP_MAX_TRIES, OTP_SENDS_PER_HOUR } from './auth.service'
import { MAIL_UNAVAILABLE } from './code-delivery.service'
import { MAIL_TRANSPORT } from '../mail/mail-transport'
import { FakeMailTransport } from '../mail/fake-mail-transport'

/*
 * LadWani's sign-in over real HTTP: the controllers, guards, validation pipe
 * and cookies as the hub serves them, against an in-memory stand-in for the
 * few Prisma calls auth makes, and an in-memory mail transport in place of
 * SMTP. No database, no network beyond loopback.
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
  // An interactive transaction runs one at a time, as the row lock it takes
  // (SELECT ... FOR UPDATE, a no-op here) makes them for one account.
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

const MAIL_ENV = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME', 'MAIL_SCHEME']
/** Hostinger email, as a tier would set it. The transport itself is the in-memory one. */
const withMail = () =>
  Object.assign(process.env, { MAIL_HOST: 'smtp.hostinger.com', MAIL_PORT: '465', MAIL_USERNAME: 'no-reply@bkesari.com', MAIL_PASSWORD: 'not-a-real-password' })
const SIX_DIGITS = /\b\d{6}\b/

describe('LadWani auth over HTTP', () => {
  let app: INestApplication
  let port: number
  let db: Row
  let mail: FakeMailTransport
  let auth: AuthService
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
    // A local run (APP_ENV unset, NODE_ENV=test) with no mail provider, unless a case sets one.
    process.env = { ...savedEnv, NODE_ENV: 'test' }
    delete process.env.APP_ENV
    for (const k of MAIL_ENV) {
      delete process.env[k]
      delete process.env[`LADWANI_${k}`]
    }
    delete process.env.LADWANI_HUB_JWKS
    delete process.env.HUB_JWKS_URL
    delete process.env.LADWANI_COOKIE_PATH
    delete process.env.COOKIE_PATH
    db = fakeDb()

    @Global()
    @Module({ providers: [{ provide: PrismaService, useValue: db }], exports: [PrismaService] })
    class FakePrismaModule {}

    mail = new FakeMailTransport()
    const moduleRef = await Test.createTestingModule({ imports: [FakePrismaModule, AuthModule] })
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(mail)
      .compile()
    auth = moduleRef.get(AuthService)
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
    it('answers 200 with no user and where to sign in when there is no session (not an error the browser logs)', async () => {
      const r = await call('GET', '/auth/session')
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ user: null, signInUrl: '/ladwani/sign-in/', mailLive: false, smsLive: false })
    })

    it('says which code channels have a provider: email once MAIL_HOST is set, never SMS while it is on hold', async () => {
      withMail()
      const r = await call('GET', '/auth/session')
      expect(r.body).toMatchObject({ mailLive: true, smsLive: false })
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
        mailLive: false,
        smsLive: false,
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

  describe('sign-in with a code by email', () => {
    it('emails the code to a registered address only, answering the same for an unknown one', async () => {
      await addUser(db)
      withMail()
      const known = await call('POST', '/auth/otp/send', { body: { email: ' Asha@Example.com ' } })
      const unknown = await call('POST', '/auth/otp/send', { body: { email: 'nobody@example.com' } })
      expect(known.status).toBe(200)
      expect(known.body).toEqual(unknown.body)
      expect(known.body).toEqual({ data: { sent: true, expiresInMinutes: 10, message: 'If this email has a LadWani account, a code is on its way.' } })
      expect(mail.outbox.map((m) => m.to)).toEqual(['asha@example.com'])
      expect(mail.to('nobody@example.com')).toEqual([])
      // The code is in the email, and stored only hashed.
      const sent = mail.outbox[0]
      expect(sent.from).toEqual({ name: 'LadWani · bkesari', address: 'no-reply@bkesari.com' })
      expect(sent.subject).toMatch(/^\d{6} is your LadWani code$/)
      expect(sent.text).toContain('It works for 10 minutes')
      expect(sent.text).toContain('This is a separate account for LadWani.')
      expect(sent.text).toContain("If you didn't ask for this, ignore this email.")
      const code = db.verificationToken.rows.find((t: Row) => t.type === 'EMAIL_LOGIN')
      expect(code.tokenHash).toMatch(/^\$2[aby]\$/)
    })

    it('signs in with the emailed code and sets the cookie; the code works once', async () => {
      const user = await addUser(db, { emailVerified: false })
      withMail()
      await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
      const code = mail.lastCode('asha@example.com')!
      const r = await call('POST', '/auth/otp/login', { body: { email: 'ASHA@example.com', otp: code } })
      expect(r.status).toBe(200)
      expect(r.body.data.user.roles).toEqual(['MEMBER'])
      expect(sid(r)).toMatch(/^[0-9a-f]{96}$/)
      expect(user.emailVerified).toBe(true)
      expect((await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: code } })).status).toBe(401)
    })

    it('writes the email in the language the shell is showing (k_lang), English otherwise', async () => {
      await addUser(db)
      withMail()
      await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' }, headers: { cookie: 'k_lang=hi' } })
      await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' }, headers: { 'accept-language': 'mr-IN,mr;q=0.9' } })
      expect(mail.outbox[0].text).toContain('यह LadWani के लिए अलग खाता है।')
      expect(mail.outbox[0].subject).toMatch(/^\d{6} आपका LadWani कोड है$/)
      // Accept-Language is never used to choose.
      expect(mail.outbox[1].text).toContain('This is a separate account for LadWani.')
    })

    describe('when the code is shown on screen (devOtp)', () => {
      it('only on the dev tier or a local run, and only with no mail provider', async () => {
        await addUser(db)
        // Local run (APP_ENV unset, NODE_ENV=test), no provider: shown, nothing emailed.
        const local = await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
        expect(local.body.devOtp).toMatch(/^\d{6}$/)
        expect(mail.outbox).toHaveLength(0)
        // The dev tier, even under NODE_ENV=production (the hub runs every tier so).
        Object.assign(process.env, { APP_ENV: 'dev', NODE_ENV: 'production' })
        expect((await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })).body.devOtp).toMatch(/^\d{6}$/)
        // The dev tier with a provider: emailed, not shown.
        withMail()
        const dev = await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
        expect(dev.status).toBe(200)
        expect(dev.body.devOtp).toBeUndefined()
        expect(mail.outbox).toHaveLength(1)
      })

      it.each([
        [{ APP_ENV: 'test' }],
        [{ APP_ENV: 'prod' }],
        [{ APP_ENV: 'staging', NODE_ENV: 'development' }],
        [{ NODE_ENV: 'production' }],
      ])('never with %j and a provider: every answer is free of the code', async (tier) => {
        await addUser(db, { failedAttempts: 0 })
        Object.assign(process.env, tier)
        withMail()
        const replies = [
          await call('POST', '/auth/register', { body: { firstName: 'Ravi', lastName: 'Patil', email: 'ravi@example.com', mobile: '9988776655' } }),
          await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } }),
          await call('POST', '/auth/otp/send', { body: { email: 'nobody@example.com' } }),
          await call('POST', '/auth/password/forgot', { body: { identifier: 'asha@example.com' } }),
        ]
        expect(replies.map((r) => r.status)).toEqual([201, 200, 200, 200])
        for (const r of replies) expect(JSON.stringify(r.body)).not.toMatch(/devOtp|\b\d{6}\b/)
        expect(mail.outbox.map((m) => m.to)).toEqual(['ravi@example.com', 'asha@example.com', 'asha@example.com'])
      })

      it.each([
        [{ APP_ENV: 'test' }],
        [{ APP_ENV: 'prod' }],
        [{ NODE_ENV: 'production' }],
      ])('with %j and no mail provider: 503 with no code, for known and unknown addresses alike', async (tier) => {
        await addUser(db)
        Object.assign(process.env, tier)
        const replies = [
          await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } }),
          await call('POST', '/auth/otp/send', { body: { email: 'nobody@example.com' } }),
          await call('POST', '/auth/password/forgot', { body: { identifier: 'asha@example.com' } }),
          await call('POST', '/auth/password/forgot', { body: { identifier: 'nobody@example.com' } }),
          await call('POST', '/auth/register', { body: { firstName: 'Ravi', lastName: 'Patil', email: 'ravi@example.com', mobile: '9988776655' } }),
          // The mobile path too: no SMS provider while SMS is on hold.
          await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } }),
        ]
        expect(replies.map((r) => r.status)).toEqual([503, 503, 503, 503, 503, 503])
        expect(replies[0].body).toEqual(replies[1].body)
        expect(replies[0].body.message).toBe(MAIL_UNAVAILABLE)
        expect(MAIL_UNAVAILABLE).toBe('We could not send the email right now. Try again later or sign in with your password.')
        for (const r of replies) expect(JSON.stringify(r.body)).not.toMatch(/devOtp|\b\d{6}\b/)
        // Nothing was written: no new account, no code.
        expect(db.user.rows).toHaveLength(1)
        expect(db.verificationToken.rows).toHaveLength(0)
      })

      it('a provider that fails answers 503 with no code, even on dev', async () => {
        await addUser(db)
        process.env.APP_ENV = 'dev'
        withMail()
        mail.failWith = Object.assign(new Error('Invalid login: 535 Authentication failed'), { code: 'EAUTH' })
        const r = await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
        expect(r.status).toBe(503)
        expect(r.body.message).toBe(MAIL_UNAVAILABLE)
        expect(JSON.stringify(r.body)).not.toMatch(SIX_DIGITS)
      })
    })

    it('verifies the email and activates an account that registered but never entered its code', async () => {
      withMail()
      const reg = await call('POST', '/auth/register', { body: { firstName: 'Ravi', lastName: 'Patil', email: 'Ravi@Example.com', mobile: '9988776655' } })
      expect(reg.status).toBe(201)
      expect(reg.body.devOtp).toBeUndefined()
      const user = db.user.rows[0]
      expect(user).toMatchObject({ status: 'PENDING', email: 'ravi@example.com', mobile: '9988776655' })
      const r = await call('POST', '/auth/otp/login', { body: { email: 'ravi@example.com', otp: mail.lastCode('ravi@example.com') } })
      expect(r.status).toBe(200)
      expect(user).toMatchObject({ status: 'ACTIVE', emailVerified: true })
      // The mobile is kept, unverified while SMS is on hold.
      expect(user.mobileVerified).toBeFalsy()
    })

    it('an address someone else registered with a password: its first code ends their sessions and their password', async () => {
      withMail()
      // Someone registers another person's email with a password of their own, and signs in with it.
      const reg = await call('POST', '/auth/register', { body: { firstName: 'Ravi', lastName: 'Patil', email: 'ravi@example.com', mobile: '9988776655', password: 'Chosen1pass' } })
      expect(reg.status).toBe(201)
      const theirs = await call('POST', '/auth/login', { body: { identifier: 'ravi@example.com', password: 'Chosen1pass' } })
      expect(theirs.status).toBe(200)
      // The person who reads that inbox carries on with a code (the web does, after a 409).
      await call('POST', '/auth/otp/send', { body: { email: 'ravi@example.com' } })
      const mine = await call('POST', '/auth/otp/login', { body: { email: 'ravi@example.com', otp: mail.lastCode('ravi@example.com') } })
      expect(mine.status).toBe(200)
      expect((await call('GET', '/auth/session', { headers: { cookie: `lw_sid=${sid(theirs)}` } })).body.user).toBeNull()
      expect((await call('POST', '/auth/refresh', { headers: { cookie: `lw_sid=${sid(theirs)}` } })).status).toBe(401)
      expect((await call('POST', '/auth/login', { body: { identifier: 'ravi@example.com', password: 'Chosen1pass' } })).status).toBe(401)
      expect((await call('GET', '/auth/session', { headers: { cookie: `lw_sid=${sid(mine)}` } })).body.user).toMatchObject({ email: 'ravi@example.com' })
      // Once the address is proven, a later code sign-in ends nothing.
      await call('POST', '/auth/otp/send', { body: { email: 'ravi@example.com' } })
      expect((await call('POST', '/auth/otp/login', { body: { email: 'ravi@example.com', otp: mail.lastCode('ravi@example.com') } })).status).toBe(200)
      expect((await call('GET', '/auth/session', { headers: { cookie: `lw_sid=${sid(mine)}` } })).body.user).toMatchObject({ email: 'ravi@example.com' })
    })

    it('voids a code after 5 wrong tries', async () => {
      await addUser(db)
      const sent = await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
      const wrongCode = sent.body.devOtp === '000000' ? '111111' : '000000'
      const replies = []
      for (let i = 0; i < OTP_MAX_TRIES; i++) replies.push(await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: wrongCode } }))
      expect(replies.map((r) => r.status)).toEqual(Array(OTP_MAX_TRIES).fill(401))
      expect(replies[OTP_MAX_TRIES - 1].body.message).toMatch(/Too many wrong codes/)
      expect((await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: sent.body.devOtp } })).status).toBe(401)
    })

    it(`sends at most ${OTP_SENDS_PER_HOUR} codes an hour to one account, answering the same`, async () => {
      await addUser(db)
      withMail()
      const replies = []
      for (let i = 0; i < OTP_SENDS_PER_HOUR + 1; i++) replies.push(await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } }))
      expect(replies.map((r) => r.status)).toEqual(Array(OTP_SENDS_PER_HOUR + 1).fill(200))
      expect(new Set(replies.map((r) => JSON.stringify(r.body))).size).toBe(1)
      expect(mail.outbox).toHaveLength(OTP_SENDS_PER_HOUR)
      expect(db.verificationToken.rows.filter((t: Row) => t.type === 'EMAIL_LOGIN')).toHaveLength(OTP_SENDS_PER_HOUR)
      // Only the newest code works.
      const codes = mail.to('asha@example.com').map((m) => SIX_DIGITS.exec(m.text)![0])
      expect((await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: codes[0] } })).status).toBe(401)
      expect((await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: codes[codes.length - 1] } })).status).toBe(200)
    })

    it('still works while the password is locked, and clears the lock', async () => {
      const user = await addUser(db, { failedAttempts: 5, lockedUntil: new Date(Date.now() + 10 * 60_000) })
      const sent = await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
      expect((await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: sent.body.devOtp } })).status).toBe(200)
      expect(user).toMatchObject({ failedAttempts: 0, lockedUntil: null })
    })

    it('refuses a suspended account and sends it nothing', async () => {
      await addUser(db, { status: 'SUSPENDED' })
      withMail()
      const sent = await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
      expect(sent.status).toBe(200)
      expect(mail.outbox).toHaveLength(0)
    })

    it('rejects a malformed email or code before looking anything up', async () => {
      expect((await call('POST', '/auth/otp/send', { body: { email: 'not-an-email' } })).status).toBe(400)
      expect((await call('POST', '/auth/otp/send', { body: {} })).status).toBe(400)
      expect((await call('POST', '/auth/otp/send', { body: { email: '' } })).status).toBe(400)
      expect((await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: '12ab56' } })).status).toBe(400)
    })

    it('an email code does not sign in by mobile number, nor a mobile code by email', async () => {
      await addUser(db)
      const byEmail = await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
      expect((await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: byEmail.body.devOtp } })).status).toBe(401)
      const byMobile = await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } })
      expect((await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: byMobile.body.devOtp } })).status).toBe(401)
    })

    describe('requests sent together', () => {
      it(`cannot buy one code more than ${OTP_MAX_TRIES} comparisons, and the code is void after`, async () => {
        const user = await addUser(db)
        const { devOtp } = await auth.sendLoginOtp({ email: 'asha@example.com' })
        const wrong = devOtp === '000000' ? '111111' : '000000'
        const results = await Promise.allSettled(Array.from({ length: 12 }, () => auth.loginWithOtp({ email: 'asha@example.com' }, wrong)))
        const messages = results.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : 'signed in'))
        expect(messages.filter((m) => m === 'signed in')).toEqual([])
        expect(messages.filter((m) => /not right/.test(m)).length).toBeLessThanOrEqual(OTP_MAX_TRIES - 1)
        expect(db.verificationToken.rows.filter((t: Row) => t.type === 'OTP_MISS' && t.userId === user.id)).toHaveLength(12)
        await expect(auth.loginWithOtp({ email: 'asha@example.com' }, devOtp!)).rejects.toThrow(/expired|Too many/)
      })

      it('let the right code sign in once (a double tap on Sign in included)', async () => {
        await addUser(db)
        const { devOtp } = await auth.sendLoginOtp({ email: 'asha@example.com' })
        // Every try counts before it is compared, right ones too, so more at once than the budget all fail closed.
        const results = await Promise.allSettled(Array.from({ length: OTP_MAX_TRIES }, () => auth.loginWithOtp({ email: 'asha@example.com' }, devOtp!)))
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      })

      it(`send at most ${OTP_SENDS_PER_HOUR} emails an hour`, async () => {
        await addUser(db)
        withMail()
        const results = await Promise.allSettled(Array.from({ length: 8 }, () => auth.sendLoginOtp({ email: 'asha@example.com' })))
        expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
        expect(mail.outbox).toHaveLength(OTP_SENDS_PER_HOUR)
      })
    })
  })

  describe('sign-in with a code by mobile (kept for when SMS is back)', () => {
    it('works on a local run with no provider: the code is shown, nothing is sent', async () => {
      await addUser(db)
      const sent = await call('POST', '/auth/otp/send', { body: { mobile: '+91 98765 43210' } })
      expect(sent.body.data.message).toBe('If this number has a LadWani account, a code is on its way.')
      expect(sent.body.devOtp).toMatch(/^\d{6}$/)
      const r = await call('POST', '/auth/otp/login', { body: { mobile: '9876543210', otp: sent.body.devOtp } })
      expect(r.status).toBe(200)
      expect(mail.outbox).toHaveLength(0)
    })

    it('answers 503 on the test tier even with mail configured: no SMS provider', async () => {
      await addUser(db)
      process.env.APP_ENV = 'test'
      withMail()
      const r = await call('POST', '/auth/otp/send', { body: { mobile: '9876543210' } })
      expect(r.status).toBe(503)
      expect(JSON.stringify(r.body)).not.toMatch(SIX_DIGITS)
    })

    it('rejects a malformed number', async () => {
      expect((await call('POST', '/auth/otp/send', { body: { mobile: '12345' } })).status).toBe(400)
    })
  })

  describe('forgot password by a code by email', () => {
    it('answers the same whether or not the account exists, and emails only a real one (production)', async () => {
      await addUser(db)
      Object.assign(process.env, { APP_ENV: 'prod', NODE_ENV: 'production' })
      withMail()
      const known = await call('POST', '/auth/password/forgot', { body: { identifier: 'Asha@Example.com' } })
      const unknown = await call('POST', '/auth/password/forgot', { body: { identifier: 'nobody@example.com' } })
      expect(known.status).toBe(200)
      expect(known.body).toEqual(unknown.body)
      expect(known.body.data.message).toBe('If an account matches, a code is on its way to its email address.')
      expect(known.body.devOtp).toBeUndefined()
      expect(mail.outbox.map((m) => m.to)).toEqual(['asha@example.com'])
      expect(mail.outbox[0].text).toContain('Enter it to set a new LadWani password.')
    })

    it('found by the mobile number, the code still goes to the email', async () => {
      await addUser(db)
      withMail()
      await call('POST', '/auth/password/forgot', { body: { identifier: '98765 43210' } })
      expect(mail.outbox.map((m) => m.to)).toEqual(['asha@example.com'])
    })

    it('an account with no email gets nothing while SMS is on hold, answered the same', async () => {
      await addUser(db, { email: null })
      Object.assign(process.env, { APP_ENV: 'test' })
      withMail()
      const r = await call('POST', '/auth/password/forgot', { body: { identifier: '9876543210' } })
      expect(r.status).toBe(200)
      expect(r.body.devOtp).toBeUndefined()
      expect(mail.outbox).toHaveLength(0)
      expect(db.verificationToken.rows).toHaveLength(0)
    })

    it('resets with the code: new password works, lock cleared, every session ended', async () => {
      const user = await addUser(db, { failedAttempts: 5, lockedUntil: new Date(Date.now() + 10 * 60_000) })
      withMail()
      // A session from before, e.g. on a phone that was lost.
      await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
      const before = await call('POST', '/auth/otp/login', { body: { email: 'asha@example.com', otp: mail.lastCode('asha@example.com') } })
      expect(before.status).toBe(200)
      await call('POST', '/auth/password/forgot', { body: { identifier: 'asha@example.com' } })
      const code = mail.lastCode('asha@example.com')!
      const bad = await call('POST', '/auth/password/reset', { body: { identifier: 'asha@example.com', otp: code === '000000' ? '111111' : '000000', password: 'NewPass123' } })
      expect(bad.status).toBe(400)
      const weak = await call('POST', '/auth/password/reset', { body: { identifier: 'asha@example.com', otp: code, password: 'short' } })
      expect(weak.status).toBe(400)

      const ok = await call('POST', '/auth/password/reset', { body: { identifier: 'asha@example.com', otp: code, password: 'NewPass123' } })
      expect(ok.status).toBe(200)
      expect(ok.body.data).toEqual({ reset: true })
      expect(user).toMatchObject({ failedAttempts: 0, lockedUntil: null, emailVerified: true })
      expect(db.refreshToken.rows.every((t: Row) => t.revokedAt)).toBe(true)
      expect((await call('POST', '/auth/refresh', { headers: { cookie: `lw_sid=${sid(before)}` } })).status).toBe(401)
      expect((await call('POST', '/auth/login', { body: { identifier: 'asha@example.com', password: 'NewPass123' } })).status).toBe(200)
    })

    it('does not accept a sign-in code as a reset code', async () => {
      await addUser(db)
      const sent = await call('POST', '/auth/otp/send', { body: { email: 'asha@example.com' } })
      const r = await call('POST', '/auth/password/reset', { body: { identifier: 'asha@example.com', otp: sent.body.devOtp, password: 'NewPass123' } })
      expect(r.status).toBe(400)
    })

    it('the lock message offers a code by email', async () => {
      await addUser(db)
      for (let i = 0; i < 4; i++) await call('POST', '/auth/login', { body: { identifier: 'asha@example.com', password: 'Wrong1pass' } })
      const fifth = await call('POST', '/auth/login', { body: { identifier: 'asha@example.com', password: 'Wrong1pass' } })
      expect(fifth.body.message).toMatch(/or sign in with a code sent to your email\.$/)
    })
  })

  describe('sign-up', () => {
    it('needs an email: the code verifies it', async () => {
      const noEmail = await call('POST', '/auth/register', { body: { firstName: 'Meera', lastName: 'Joshi', mobile: '9876543211' } })
      expect(noEmail.status).toBe(400)
      expect(noEmail.body.message).toContain('Enter a valid email address')
      expect((await call('POST', '/auth/register', { body: { firstName: 'Meera', lastName: 'Joshi', email: 'meera@', mobile: '9876543211' } })).status).toBe(400)
      expect(db.user.rows).toHaveLength(0)
    })

    it('can start without a password: the code goes by email and the account signs in with it', async () => {
      withMail()
      const reg = await call('POST', '/auth/register', { body: { firstName: 'Meera', lastName: 'Joshi', email: ' Meera@Example.com', mobile: '098765 43211' } })
      expect(reg.status).toBe(201)
      expect(reg.body.data).toMatchObject({ userId: expect.any(String), sent: true, expiresInMinutes: 10 })
      expect(reg.body.devOtp).toBeUndefined()
      expect(db.user.rows[0]).toMatchObject({ email: 'meera@example.com', mobile: '9876543211' })
      expect(db.user.rows[0].passwordHash).toMatch(/^\$2[aby]\$/)
      expect(mail.to('meera@example.com')).toHaveLength(1)
      expect(mail.outbox[0].text).toContain('Enter it to finish joining LadWani.')
    })

    it('says which of email or mobile is taken (409 with a reason)', async () => {
      await addUser(db)
      const email = await call('POST', '/auth/register', { body: { firstName: 'Asha', lastName: 'L', email: 'ASHA@example.com', mobile: '9123456780' } })
      expect(email.status).toBe(409)
      expect(email.body).toMatchObject({ reason: 'EMAIL_TAKEN', message: 'An account with this email already exists.' })
      const mobile = await call('POST', '/auth/register', { body: { firstName: 'Asha', lastName: 'L', email: 'other@example.com', mobile: '9876543210' } })
      expect(mobile.status).toBe(409)
      expect(mobile.body).toMatchObject({ reason: 'MOBILE_TAKEN' })
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
