import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { hash } from 'bcryptjs'
import { AuthService, normalizeEmail } from './auth.service'
import { CodeDeliveryService } from './code-delivery.service'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { MAIL_TRANSPORT } from '../mail/mail-transport'
import { FakeMailTransport } from '../mail/fake-mail-transport'

const MAIL_ENV = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME', 'MAIL_SCHEME']

describe('AuthService', () => {
  let service: AuthService
  let prisma: any
  let mail: FakeMailTransport
  const savedEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  beforeEach(async () => {
    // A local run with no mail provider, unless a case sets one.
    process.env = { ...savedEnv, NODE_ENV: 'test' }
    delete process.env.APP_ENV
    for (const k of MAIL_ENV) {
      delete process.env[k]
      delete process.env[`LADWANI_${k}`]
    }
    mail = new FakeMailTransport()

    prisma = {
      user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
      member: { create: jest.fn() },
      role: { findUnique: jest.fn(), create: jest.fn() },
      userRole: { create: jest.fn() },
      verificationToken: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn(() => 'signed.jwt.token') } },
        CodeDeliveryService,
        MailService,
        { provide: MAIL_TRANSPORT, useValue: mail },
      ],
    }).compile()

    service = moduleRef.get(AuthService)
  })

  describe('register', () => {
    const dto = { firstName: 'Ramesh', lastName: 'Ladwani', email: 'ramesh@example.com', mobile: '9876543210', password: 'Passw0rd' }
    const newTx = () => ({
      user: { create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      member: { create: jest.fn().mockResolvedValue({ id: 'member-1' }) },
      userRole: { create: jest.fn().mockResolvedValue({}) },
      verificationToken: { create: jest.fn().mockResolvedValue({}) },
    })

    it('rejects a duplicate email first, naming it (EMAIL_TAKEN)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' })
      const err = await service.register(dto).catch((e) => e)
      expect(err).toBeInstanceOf(ConflictException)
      expect(err.getResponse()).toMatchObject({ statusCode: 409, reason: 'EMAIL_TAKEN' })
      expect(prisma.user.findUnique).toHaveBeenCalledTimes(1)
    })

    it('rejects a duplicate mobile number (MOBILE_TAKEN)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null) // email check passes
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' }) // mobile check fails
      const err = await service.register(dto).catch((e) => e)
      expect(err).toBeInstanceOf(ConflictException)
      expect(err.getResponse()).toMatchObject({ reason: 'MOBILE_TAKEN' })
    })

    it("refuses the hub's built-in administrators' addresses, however they are typed", async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      for (const email of ['smorankar@builtin.bkesari.com', ' SonaliMorankar@Builtin.Bkesari.com ', 'anyone@builtin.bkesari.com']) {
        await expect(service.register({ ...dto, email })).rejects.toThrow('This email address is reserved.')
      }
      expect(prisma.user.create).not.toHaveBeenCalled()
    })

    it('checks for a duplicate email lower-cased, since PostgreSQL compares emails exactly', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' })
      await expect(service.register({ ...dto, email: '  Taken@Example.COM ' })).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'taken@example.com' } })
    })

    it('stores the email lower-cased', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.role.findUnique.mockResolvedValue({ id: 'role-member', code: 'MEMBER' })
      const tx = newTx()
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx))
      await service.register({ ...dto, email: 'Asha@Example.com' })
      expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'asha@example.com' }) })
    })

    it('creates the user, member, role grant, and an email verification code inside one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.role.findUnique.mockResolvedValue({ id: 'role-member', code: 'MEMBER' })
      const tx = newTx()
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx))

      const result = await service.register(dto)

      expect(result.userId).toBe('user-1')
      // A local run with no mail provider: the code comes back for the screen.
      expect(result.devOtp).toMatch(/^\d{6}$/)
      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'ramesh@example.com', mobile: dto.mobile, status: 'PENDING' }) }),
      )
      expect(tx.member.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', firstName: 'Ramesh' }) }),
      )
      expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: 'user-1', roleId: 'role-member' } })
      expect(tx.verificationToken.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'EMAIL_VERIFY', tokenHash: expect.stringMatching(/^\$2[aby]\$/) }) })
    })

    it('emails the code when a mail provider is configured, and hands back none', async () => {
      Object.assign(process.env, { MAIL_HOST: 'smtp.example.test', MAIL_USERNAME: 'no-reply@example.test', MAIL_PASSWORD: 'secret' })
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.role.findUnique.mockResolvedValue({ id: 'role-member', code: 'MEMBER' })
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(newTx()))

      const result = await service.register(dto, 'mr')

      expect(result).toEqual({ userId: 'user-1' })
      expect(mail.outbox).toHaveLength(1)
      expect(mail.outbox[0]).toMatchObject({ to: 'ramesh@example.com', from: { name: 'LadWani · bkesari', address: 'no-reply@example.test' } })
      expect(mail.outbox[0].text).toContain('हे LadWani साठी स्वतंत्र खाते आहे.')
      expect(mail.lastCode('ramesh@example.com')).toMatch(/^\d{6}$/)
    })

    it('answers 503 on the test tier with no mail provider, before writing anything', async () => {
      process.env.APP_ENV = 'test'
      await expect(service.register(dto)).rejects.toBeInstanceOf(ServiceUnavailableException)
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('login', () => {
    it('looks the email up lower-cased and the mobile number as typed', async () => {
      prisma.user.findFirst.mockResolvedValue(null)
      await expect(service.login({ identifier: 'Asha@Example.com', password: 'x' })).rejects.toBeInstanceOf(UnauthorizedException)
      expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { OR: [{ email: 'asha@example.com' }, { mobile: 'Asha@Example.com' }], deletedAt: null },
      }))
    })

    it('rejects when no matching user exists', async () => {
      prisma.user.findFirst.mockResolvedValue(null)
      await expect(service.login({ identifier: '9876543210', password: 'x' })).rejects.toBeInstanceOf(UnauthorizedException)
    })

    it('rejects a suspended account even with the correct password', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        status: 'SUSPENDED',
        passwordHash: 'irrelevant',
        failedAttempts: 0,
        lockedUntil: null,
        userRoles: [],
        member: null,
      })
      await expect(service.login({ identifier: '9876543210', password: 'x' })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('rejects a locked account before even checking the password', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        status: 'ACTIVE',
        passwordHash: 'irrelevant',
        failedAttempts: 5,
        lockedUntil: new Date(Date.now() + 60_000),
        userRoles: [],
        member: null,
      })
      await expect(service.login({ identifier: '9876543210', password: 'x' })).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('increments failedAttempts on a wrong password and locks for 15 minutes at the fifth', async () => {
      const passwordHash = await hash('correct-password', 4)
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        status: 'ACTIVE',
        passwordHash,
        failedAttempts: 4,
        lockedUntil: null,
        userRoles: [],
        member: null,
      })

      const before = Date.now()
      await expect(service.login({ identifier: '9876543210', password: 'wrong' })).rejects.toBeInstanceOf(ForbiddenException)

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({ failedAttempts: 5, lockedUntil: expect.any(Date) }),
      })
      const lockedUntil: Date = prisma.user.update.mock.calls[0][0].data.lockedUntil
      const minutes = (lockedUntil.getTime() - before) / 60_000
      expect(minutes).toBeGreaterThanOrEqual(15)
      expect(minutes).toBeLessThan(15.1)
    })

    it('counts a wrong password below the threshold without locking', async () => {
      const passwordHash = await hash('correct-password', 4)
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1', status: 'ACTIVE', passwordHash, failedAttempts: 3, lockedUntil: null, userRoles: [], member: null,
      })
      await expect(service.login({ identifier: '9876543210', password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException)
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { failedAttempts: 4, lockedUntil: undefined } })
    })

    it('finds a mobile number typed with +91 and spaces', async () => {
      prisma.user.findFirst.mockResolvedValue(null)
      await expect(service.login({ identifier: '+91 98765 43210', password: 'x' })).rejects.toBeInstanceOf(UnauthorizedException)
      expect(prisma.user.findFirst.mock.calls[0][0].where.OR).toContainEqual({ mobile: '9876543210' })
    })

    it('logs in successfully, resets failedAttempts, and issues an access + refresh token', async () => {
      const passwordHash = await hash('correct-password', 4)
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        status: 'ACTIVE',
        passwordHash,
        failedAttempts: 2,
        lockedUntil: null,
        userRoles: [{ role: { code: 'MEMBER' } }],
        member: { id: 'member-1' },
      })
      prisma.refreshToken.create.mockResolvedValue({})

      const result = await service.login({ identifier: '9876543210', password: 'correct-password' })

      expect(result.accessToken).toBe('signed.jwt.token')
      expect(result.user).toEqual({ id: 'u1', roles: ['MEMBER'], memberId: 'member-1' })
      expect(typeof result.refreshToken).toBe('string')
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: expect.any(Date) },
      })
    })
  })

  describe('refresh', () => {
    it('rejects an unknown, revoked, or expired refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null)
      await expect(service.refresh('nonexistent')).rejects.toBeInstanceOf(UnauthorizedException)

      prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 999999) })
      await expect(service.refresh('revoked-one')).rejects.toBeInstanceOf(UnauthorizedException)

      prisma.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) })
      await expect(service.refresh('expired-one')).rejects.toBeInstanceOf(UnauthorizedException)
    })

    it('rotates: revokes the presented token and issues a brand new pair', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 999999),
      })
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        userRoles: [{ role: { code: 'KARTA' } }],
        member: { id: 'member-1' },
      })
      prisma.refreshToken.create.mockResolvedValue({})

      const result = await service.refresh('valid-raw-token')

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({ where: { id: 'rt1' }, data: { revokedAt: expect.any(Date) } })
      expect(result.user.roles).toEqual(['KARTA'])
      expect(result.accessToken).toBe('signed.jwt.token')
    })
  })
})

describe('normalizeEmail', () => {
  it('trims and lower-cases, and maps blank or absent to null', () => {
    expect(normalizeEmail('  Asha@Example.COM ')).toBe('asha@example.com')
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })
})
