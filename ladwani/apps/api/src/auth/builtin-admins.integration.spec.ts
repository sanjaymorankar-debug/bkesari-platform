import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { FakeMailTransport } from '../mail/fake-mail-transport'
import { AuthService, BUILTIN_ENTITY, TOO_MANY_TRIES } from './auth.service'
import { CodeDeliveryService } from './code-delivery.service'
import { BUILTIN_EMAIL_DOMAIN, BUILTIN_TRIES_PER_IP, BUILTIN_TRIES_PER_NAME, hashBuiltinPassword } from './builtin-admins'

/**
 * The built-in administrators' sign-in (D-036) under requests sent together,
 * against a live PostgreSQL: the try limits (an audit_logs row per try,
 * written before the check and counted after it), and one LadWani row per
 * administrator however many first sign-ins arrive at once (the users.email
 * unique index, then a row lock while the member row and the ADMIN grant are
 * put back). It signs in as the real usernames, so like the other
 * integration specs: a THROWAWAY local database only (`npm run test:local`,
 * or `test:integration` in CI), never the default `npm test`.
 */
describe('Built-in administrators under concurrency (real PostgreSQL)', () => {
  const prisma = new PrismaService()
  const auth = new AuthService(prisma, { sign: () => 'signed.jwt.token' } as unknown as JwtService, new CodeDeliveryService(new MailService(new FakeMailTransport())))
  const PASSWORD = 'test-only-builtin-password-1'
  const saved = { ...process.env }

  async function clean() {
    const users = await prisma.user.findMany({ where: { email: { endsWith: `@${BUILTIN_EMAIL_DOMAIN}` } }, select: { id: true } })
    const ids = users.map((u) => u.id)
    await prisma.member.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.auditLog.deleteMany({ where: { entityType: BUILTIN_ENTITY } })
  }

  beforeAll(async () => {
    await prisma.$connect()
    process.env.BUILTIN_ADMIN_PASSWORD_HASH = await hashBuiltinPassword(PASSWORD, { N: 2 ** 14, r: 8, p: 1 })
  })
  beforeEach(clean)
  afterAll(async () => {
    await clean()
    await prisma.$disconnect()
    process.env = saved
  })

  const outcomes = (results: PromiseSettledResult<unknown>[]) => results.map((r) => (r.status === 'fulfilled' ? 'signed in' : (r.reason as Error).message))

  it(`lets ${BUILTIN_TRIES_PER_IP} tries from one address through, one after another, and refuses the next`, async () => {
    for (let i = 0; i < BUILTIN_TRIES_PER_IP; i++) {
      await expect(auth.login({ identifier: 'smorankar', password: PASSWORD }, '203.0.113.40')).resolves.toMatchObject({ user: { roles: ['ADMIN'] } })
    }
    await expect(auth.login({ identifier: 'smorankar', password: PASSWORD }, '203.0.113.40')).rejects.toThrow(TOO_MANY_TRIES)
    await expect(auth.login({ identifier: 'smorankar', password: PASSWORD }, '203.0.113.41')).resolves.toMatchObject({ user: { roles: ['ADMIN'] } })
    expect(await prisma.user.count({ where: { email: `smorankar@${BUILTIN_EMAIL_DOMAIN}` } })).toBe(1)
  })

  // A burst past the limit fails closed: each try is counted before any is
  // checked, so a burst can be refused whole, never let past the limit.
  it(`checks at most ${BUILTIN_TRIES_PER_IP} passwords from one address, however many tries arrive at once`, async () => {
    const results = await Promise.allSettled(Array.from({ length: 30 }, () => auth.login({ identifier: 'smorankar', password: PASSWORD }, '203.0.113.50')))
    const said = outcomes(results)
    expect(said.filter((m) => m === 'signed in').length).toBeLessThanOrEqual(BUILTIN_TRIES_PER_IP)
    expect(said.filter((m) => m !== 'signed in').every((m) => m === TOO_MANY_TRIES)).toBe(true)
    expect(await prisma.auditLog.count({ where: { entityType: BUILTIN_ENTITY, ipAddress: '203.0.113.50' } })).toBe(30)
    expect(await prisma.user.count({ where: { email: `smorankar@${BUILTIN_EMAIL_DOMAIN}` } })).toBeLessThanOrEqual(1)
  })

  it(`checks at most ${BUILTIN_TRIES_PER_NAME} passwords for one username, from any number of addresses`, async () => {
    const results = await Promise.allSettled(Array.from({ length: 70 }, (_, i) => auth.login({ identifier: 'sonalimorankar', password: 'wrong' }, `198.51.100.${i}`)))
    const said = outcomes(results)
    expect(said.filter((m) => m === 'Invalid credentials.').length).toBeLessThanOrEqual(BUILTIN_TRIES_PER_NAME)
    expect(said.filter((m) => m !== 'Invalid credentials.').every((m) => m === TOO_MANY_TRIES)).toBe(true)
  })

  it('makes one row, one member and one ADMIN grant when the first sign-ins arrive together', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => auth.login({ identifier: 'SMorankar', password: PASSWORD }, `192.0.2.${i}`)))
    expect(new Set(results.map((r) => r.user.id)).size).toBe(1)
    const [user, ...more] = await prisma.user.findMany({
      where: { email: `smorankar@${BUILTIN_EMAIL_DOMAIN}` },
      include: { member: true, userRoles: { include: { role: true } } },
    })
    expect(more).toEqual([])
    expect(user).toMatchObject({ status: 'ACTIVE', emailVerified: true, mobile: null, member: { firstName: 'smorankar' } })
    expect(user.userRoles.map((ur) => ur.role.code)).toEqual(['ADMIN'])
    expect(results.every((r) => r.user.roles.length === 1 && r.user.roles[0] === 'ADMIN')).toBe(true)
    expect(await prisma.role.count({ where: { code: 'ADMIN' } })).toBe(1)
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(8)
  })
})
