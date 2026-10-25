import { Test } from '@nestjs/testing'
import { JwtService } from '@nestjs/jwt'
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { hash } from 'bcryptjs'
import { AuthService, normalizeEmail } from './auth.service'
import { PrismaService } from '../prisma/prisma.service'
import { HubJwks } from './hub-token'

describe('AuthService', () => {
  let service: AuthService
  let prisma: any

  beforeEach(async () => {
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
        { provide: HubJwks, useValue: new HubJwks('http://unused') },
      ],
    }).compile()

    service = moduleRef.get(AuthService)
  })

  describe('register', () => {
    const dto = { firstName: 'Ramesh', lastName: 'Ladwani', mobile: '9876543210', password: 'Passw0rd' }

    it('rejects a duplicate mobile number', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' })
      await expect(service.register(dto)).rejects.toBeInstanceOf(ConflictException)
    })

    it('rejects a duplicate email when one is provided', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null) // mobile check passes
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' }) // email check fails
      await expect(service.register({ ...dto, email: 'taken@example.com' })).rejects.toBeInstanceOf(ConflictException)
    })

    it('checks for a duplicate email lower-cased, since PostgreSQL compares emails exactly', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null) // mobile check passes
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'existing' }) // email check fails
      await expect(service.register({ ...dto, email: '  Taken@Example.COM ' })).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { email: 'taken@example.com' } })
    })

    it('stores the email lower-cased', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.role.findUnique.mockResolvedValue({ id: 'role-member', code: 'MEMBER' })
      const tx = {
        user: { create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
        member: { create: jest.fn().mockResolvedValue({ id: 'member-1' }) },
        userRole: { create: jest.fn().mockResolvedValue({}) },
        verificationToken: { create: jest.fn().mockResolvedValue({}) },
      }
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx))
      await service.register({ ...dto, email: 'Asha@Example.com' })
      expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ email: 'asha@example.com' }) })
    })

    it('creates the user, member, role grant, and a verification token inside one transaction', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.role.findUnique.mockResolvedValue({ id: 'role-member', code: 'MEMBER' })

      const tx = {
        user: { create: jest.fn().mockResolvedValue({ id: 'user-1' }) },
        member: { create: jest.fn().mockResolvedValue({ id: 'member-1' }) },
        userRole: { create: jest.fn().mockResolvedValue({}) },
        verificationToken: { create: jest.fn().mockResolvedValue({}) },
      }
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx))

      const result = await service.register(dto)

      expect(result.userId).toBe('user-1')
      expect(result.otpForDev).toMatch(/^\d{6}$/)
      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ mobile: dto.mobile, status: 'PENDING' }) }),
      )
      expect(tx.member.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', firstName: 'Ramesh' }) }),
      )
      expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: 'user-1', roleId: 'role-member' } })
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

    it('increments failedAttempts on a wrong password and locks out after the threshold', async () => {
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

      await expect(service.login({ identifier: '9876543210', password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException)

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({ failedAttempts: 5, lockedUntil: expect.any(Date) }),
      })
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
