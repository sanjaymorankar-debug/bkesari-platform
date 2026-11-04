import { randomBytes } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { FakeMailTransport } from '../mail/fake-mail-transport'
import { AuthService, OTP_MAX_TRIES, OTP_SENDS_PER_HOUR } from './auth.service'
import { CodeDeliveryService } from './code-delivery.service'

/**
 * One-time codes under requests sent together, against a live PostgreSQL:
 * the per-account send limit (a row lock on the account, auth.service.ts
 * issueOtp), the try budget and single use (checkOtp). Every send is a real
 * email now, so the send limit is what keeps a burst from filling someone's
 * inbox. Like booking-concurrency.integration.spec.ts: a THROWAWAY local
 * database only (`npm run test:local`, or `test:integration` in CI), never
 * the default `npm test`. Mail goes to the in-memory transport.
 */
describe('One-time codes under concurrency (real PostgreSQL)', () => {
  const prisma = new PrismaService()
  const outbox = new FakeMailTransport()
  const auth = new AuthService(prisma, { sign: () => 'signed.jwt.token' } as unknown as JwtService, new CodeDeliveryService(new MailService(outbox)))
  const saved = { ...process.env }
  const userIds: string[] = []
  let email: string

  beforeAll(async () => {
    await prisma.$connect()
    Object.assign(process.env, { MAIL_HOST: 'smtp.example.test', MAIL_USERNAME: 'no-reply@example.test' })
    delete process.env.APP_ENV
  })

  beforeEach(async () => {
    const suffix = randomBytes(4).toString('hex')
    email = `otp-${suffix}@example.test`
    const user = await prisma.user.create({ data: { email, mobile: `8${parseInt(suffix, 16).toString().padStart(9, '0').slice(-9)}`, passwordHash: 'x', status: 'ACTIVE' } })
    userIds.push(user.id)
  })

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.verificationToken.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.$disconnect()
    process.env = saved
  })

  const userId = () => userIds[userIds.length - 1]

  it(`sends at most ${OTP_SENDS_PER_HOUR} codes an hour to one account, however many requests arrive at once`, async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => auth.sendLoginOtp({ email })))
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    expect(await prisma.verificationToken.count({ where: { userId: userId(), type: 'EMAIL_LOGIN' } })).toBe(OTP_SENDS_PER_HOUR)
    expect(outbox.to(email)).toHaveLength(OTP_SENDS_PER_HOUR)
    // Each send voids the one before: one live code.
    expect(await prisma.verificationToken.count({ where: { userId: userId(), type: 'EMAIL_LOGIN', usedAt: null } })).toBe(1)
  })

  it(`gives one code no more than ${OTP_MAX_TRIES} comparisons under parallel guesses, then voids it`, async () => {
    await auth.sendLoginOtp({ email })
    const code = outbox.lastCode(email)!
    const wrong = code === '000000' ? '111111' : '000000'
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => auth.loginWithOtp({ email }, wrong)))
    const messages = results.map((r) => (r.status === 'rejected' ? (r.reason as Error).message : 'signed in'))
    expect(messages).not.toContain('signed in')
    expect(messages.filter((m) => /not right/.test(m)).length).toBeLessThanOrEqual(OTP_MAX_TRIES - 1)
    await expect(auth.loginWithOtp({ email }, code)).rejects.toThrow(/expired|Too many/)
  })

  it('lets the right code sign in once when it is sent twice at once', async () => {
    await auth.sendLoginOtp({ email })
    const code = outbox.lastCode(email)!
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => auth.loginWithOtp({ email }, code)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await prisma.user.findUnique({ where: { id: userId() } }))?.emailVerified).toBe(true)
  })
})
