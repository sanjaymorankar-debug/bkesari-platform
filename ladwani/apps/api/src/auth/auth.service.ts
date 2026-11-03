import { createHash, randomBytes, randomInt } from 'crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { compare, hash } from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { normalizeMobile } from './dto/fields'

const ACCESS_TOKEN_TTL = '15m'
const REFRESH_TOKEN_TTL_DAYS = 30
export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15
const BCRYPT_COST = 12

/** One-time codes (docs/17 §1): 6 digits, bcrypt-hashed, 10 minutes, 3 sent per account per hour. */
export const OTP_TTL_MINUTES = 10
export const OTP_SENDS_PER_HOUR = 3
/** Tries one code allows; a wrong one at the limit voids the code. */
export const OTP_MAX_TRIES = 5

/**
 * verification_tokens.type values. Every try at a code is recorded as an
 * OTP_MISS row whose token_hash holds the id of that code (a right one removes
 * its row again), so tries are counted per code without a schema change.
 */
export const OTP_TYPES = {
  MOBILE_VERIFY: 'MOBILE_VERIFY',
  MOBILE_LOGIN: 'MOBILE_LOGIN',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const
type OtpType = (typeof OTP_TYPES)[keyof typeof OTP_TYPES]
const OTP_MISS = 'OTP_MISS'
const SENT_OTP_TYPES: string[] = Object.values(OTP_TYPES)

export type OtpCheck = 'ok' | 'none' | 'expired' | 'wrong' | 'too_many'

export interface LoginResult {
  accessToken: string
  refreshToken: string
  user: { id: string; roles: string[]; memberId: string | null }
}

/** What the app shell shows for the signed-in person (GET /auth/session). */
export interface SessionPerson {
  name: string
  email: string | null
  mobile: string | null
}

const SESSION_USER_INCLUDE = { userRoles: { include: { role: true } }, member: { select: { id: true } } } as const

const BLOCKED_STATUSES = new Set(['SUSPENDED', 'BLOCKED'])

/** Emails are stored lower-cased and trimmed; null when absent. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim()
  return trimmed ? trimmed.toLowerCase() : null
}

@Injectable()
export class AuthService {
  private readonly log = new Logger('Auth')
  /** Compared against when no account matches, so an unknown sign-in takes as long as a wrong password. */
  private noSuchUserHash?: Promise<string>

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string; otpForDev: string }> {
    const existingMobile = await this.prisma.user.findUnique({ where: { mobile: dto.mobile } })
    if (existingMobile) throw new ConflictException('An account with this mobile number already exists.')

    // Stored and compared lower-cased. PostgreSQL compares exactly, so without
    // this Asha@x.com and asha@x.com would be two accounts and a sign-in with the
    // other capitalisation would fail.
    const email = normalizeEmail(dto.email)
    if (email) {
      const existingEmail = await this.prisma.user.findUnique({ where: { email } })
      if (existingEmail) throw new ConflictException('An account with this email already exists.')
    }

    // No password yet: a random one nobody knows. Mobile + OTP signs this account
    // in, and "Forgot password" sets a real one.
    const passwordHash = await hash(dto.password ?? randomBytes(32).toString('hex'), BCRYPT_COST)
    const memberRole = await this.getOrCreateMemberRole()

    const otp = this.newOtp()
    const otpHash = await hash(otp, BCRYPT_COST)

    const userId = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, mobile: dto.mobile, passwordHash, status: 'PENDING' },
      })

      await tx.member.create({
        data: { userId: user.id, firstName: dto.firstName, lastName: dto.lastName },
      })

      await tx.userRole.create({ data: { userId: user.id, roleId: memberRole.id } })

      await tx.verificationToken.create({
        data: {
          userId: user.id,
          type: OTP_TYPES.MOBILE_VERIFY,
          tokenHash: otpHash,
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
        },
      })

      return user.id
    })

    this.deliverOtp(dto.mobile)
    return { userId, otpForDev: otp }
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ verified: true }> {
    const check = await this.checkOtp(dto.userId, [OTP_TYPES.MOBILE_VERIFY], dto.otp)
    if (check === 'none') throw new NotFoundException('No pending verification for this account.')
    if (check !== 'ok') throw new BadRequestException(otpProblem(check))
    await this.markMobileVerified(dto.userId)
    return { verified: true }
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.findByIdentifier(dto.identifier)
    if (!user) {
      await this.spendCompareTime(dto.password)
      throw new UnauthorizedException('Invalid credentials.')
    }

    if (BLOCKED_STATUSES.has(user.status)) {
      throw new ForbiddenException('Account suspended. Contact an administrator.')
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException(lockedMessage(user.lockedUntil))
    }

    const valid = await compare(dto.password, user.passwordHash)
    if (!valid) {
      const attempts = user.failedAttempts + 1
      const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : undefined
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: attempts, lockedUntil },
      })
      if (lockedUntil) throw new ForbiddenException(lockedMessage(lockedUntil))
      throw new UnauthorizedException('Invalid credentials.')
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    })

    return this.issueSession(user)
  }

  // ── Mobile + OTP sign-in ─────────────────────────────────────────────

  /**
   * Sends a sign-in code to `mobile` when it belongs to an account that may sign
   * in. The caller answers the same either way; only `otpForDev` (never in
   * production) differs.
   */
  async sendLoginOtp(mobile: string): Promise<{ otpForDev?: string }> {
    const user = await this.prisma.user.findFirst({ where: { mobile, deletedAt: null } })
    if (!user || BLOCKED_STATUSES.has(user.status)) return {}
    return this.issueOtp(user.id, user.mobile, OTP_TYPES.MOBILE_LOGIN)
  }

  /**
   * Signs in with a code from sendLoginOtp (or the one sent at sign-up, which
   * proves the same thing: this person holds the phone). A password lock does
   * not apply: it stops password guessing, and codes have their own limits.
   */
  async loginWithOtp(mobile: string, otp: string): Promise<LoginResult> {
    const user = await this.prisma.user.findFirst({ where: { mobile, deletedAt: null }, include: SESSION_USER_INCLUDE })
    if (!user) {
      await this.spendCompareTime(otp)
      throw new UnauthorizedException(otpProblem('wrong'))
    }
    if (BLOCKED_STATUSES.has(user.status)) throw new ForbiddenException('Account suspended. Contact an administrator.')

    const check = await this.checkOtp(user.id, [OTP_TYPES.MOBILE_LOGIN, OTP_TYPES.MOBILE_VERIFY], otp)
    if (check !== 'ok') throw new UnauthorizedException(otpProblem(check))

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        mobileVerified: true,
        ...(user.status === 'PENDING' ? { status: 'ACTIVE' } : {}),
      },
    })
    return this.issueSession(user)
  }

  // ── Forgot password ─────────────────────────────────────────────────

  /** Sends a reset code to the account's mobile. Same answer whether or not it exists. */
  async requestPasswordReset(identifier: string): Promise<{ otpForDev?: string }> {
    const user = await this.findByIdentifier(identifier)
    if (!user || !user.mobile || BLOCKED_STATUSES.has(user.status)) return {}
    return this.issueOtp(user.id, user.mobile, OTP_TYPES.PASSWORD_RESET)
  }

  /** Sets a new password with a reset code, clears any lock and ends every session. */
  async resetPassword(identifier: string, otp: string, password: string): Promise<{ reset: true }> {
    const user = await this.findByIdentifier(identifier)
    if (!user || BLOCKED_STATUSES.has(user.status)) {
      await this.spendCompareTime(otp)
      throw new BadRequestException(otpProblem('wrong'))
    }

    const check = await this.checkOtp(user.id, [OTP_TYPES.PASSWORD_RESET], otp)
    if (check !== 'ok') throw new BadRequestException(otpProblem(check))

    const passwordHash = await hash(password, BCRYPT_COST)
    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        // The code went to this mobile, so the number is verified too.
        data: { passwordHash, failedAttempts: 0, lockedUntil: null, mobileVerified: true },
      }),
      this.prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
    ])
    return { reset: true }
  }

  // ── Sessions ────────────────────────────────────────────────────────

  async refresh(rawRefreshToken: string): Promise<LoginResult> {
    const tokenHash = this.hashToken(rawRefreshToken)
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } })

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired. Please log in again.')
    }

    // Rotation: the presented token is single-use regardless of outcome.
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } })

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId }, include: SESSION_USER_INCLUDE })
    if (!user || user.deletedAt || BLOCKED_STATUSES.has(user.status)) {
      throw new UnauthorizedException('Session expired. Please log in again.')
    }

    return this.issueSession(user)
  }

  /**
   * Who the session cookie belongs to, for the app shell. Reads the token and
   * never rotates it: the shell asks on every page, the app refreshes on its own.
   */
  async sessionPerson(rawRefreshToken: string | undefined): Promise<SessionPerson | null> {
    if (!rawRefreshToken) return null
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.hashToken(rawRefreshToken) } })
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) return null
    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { member: { select: { firstName: true, lastName: true } } },
    })
    if (!user || user.deletedAt || BLOCKED_STATUSES.has(user.status)) return null
    const name = [user.member?.firstName, user.member?.lastName].filter(Boolean).join(' ').trim()
    return { name: name || user.email || user.mobile || '', email: user.email, mobile: user.mobile }
  }

  async logout(rawRefreshToken: string): Promise<{ loggedOut: true }> {
    const tokenHash = this.hashToken(rawRefreshToken)
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { loggedOut: true }
  }

  // ── One-time codes ──────────────────────────────────────────────────

  /**
   * Issues a code of `type` for the account, voiding its earlier unused codes of
   * that type. Past OTP_SENDS_PER_HOUR codes in the last hour nothing is sent,
   * and the caller still answers as if it had been.
   */
  private async issueOtp(userId: string, mobile: string | null, type: OtpType): Promise<{ otpForDev?: string }> {
    const since = new Date(Date.now() - 60 * 60 * 1000)
    const recent = await this.prisma.verificationToken.count({
      where: { userId, type: { in: SENT_OTP_TYPES }, createdAt: { gte: since } },
    })
    if (recent >= OTP_SENDS_PER_HOUR) return {}

    const otp = this.newOtp()
    const tokenHash = await hash(otp, BCRYPT_COST)
    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: now } }),
      this.prisma.verificationToken.create({
        data: { userId, type, tokenHash, expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000) },
      }),
    ])
    if (mobile) this.deliverOtp(mobile)
    return { otpForDev: otp }
  }

  /**
   * Checks `otp` against the newest live code of `types` and uses it up when it
   * matches. Each try is recorded BEFORE the comparison, so requests sent in
   * parallel cannot buy one code more than OTP_MAX_TRIES comparisons.
   */
  async checkOtp(userId: string, types: OtpType[], otp: string): Promise<OtpCheck> {
    const token = await this.prisma.verificationToken.findFirst({
      where: { userId, type: { in: types }, usedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (!token) return 'none'
    if (token.expiresAt < new Date()) return 'expired'

    const attempt = await this.prisma.verificationToken.create({
      data: { userId, type: OTP_MISS, tokenHash: token.id, expiresAt: token.expiresAt, usedAt: new Date() },
    })
    const tries = await this.prisma.verificationToken.count({ where: { userId, type: OTP_MISS, tokenHash: token.id } })
    const voidCode = () => this.prisma.verificationToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } })
    if (tries > OTP_MAX_TRIES) {
      await voidCode()
      return 'too_many'
    }

    if (await compare(otp, token.tokenHash)) {
      await this.prisma.verificationToken.delete({ where: { id: attempt.id } })
      // Single use, even under two requests at once: only one update claims it.
      const claimed = await voidCode()
      return claimed.count === 1 ? 'ok' : 'expired'
    }
    if (tries >= OTP_MAX_TRIES) {
      await voidCode()
      return 'too_many'
    }
    return 'wrong'
  }

  /**
   * No SMS provider is wired in yet (docs/02 §17 defers it). Outside production
   * the API hands the code back as `devOtp`; in production it is only noted
   * here that a code could not be sent, never the code itself.
   */
  private deliverOtp(mobile: string): void {
    if (process.env.NODE_ENV === 'production') {
      this.log.warn(`No SMS provider is configured; a code for …${mobile.slice(-4)} was not delivered.`)
    }
  }

  /** A bcrypt comparison that can never match, so "no such account" takes as long as a wrong answer. */
  private async spendCompareTime(value: string): Promise<void> {
    this.noSuchUserHash ??= hash(randomBytes(16).toString('hex'), BCRYPT_COST)
    await compare(value, await this.noSuchUserHash)
  }

  private newOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0')
  }

  /** A verified mobile activates a new account; it never lifts a suspension. */
  private async markMobileVerified(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('No pending verification for this account.')
    await this.prisma.user.update({
      where: { id: userId },
      data: { mobileVerified: true, ...(user.status === 'PENDING' ? { status: 'ACTIVE' } : {}) },
    })
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /** One code path for "email or mobile": email lower-cased, mobile reduced to its 10 digits. */
  private findByIdentifier(identifier: string) {
    const mobile = normalizeMobile(identifier) as string
    return this.prisma.user.findFirst({
      where: { OR: [{ email: normalizeEmail(identifier) }, { mobile }], deletedAt: null },
      include: SESSION_USER_INCLUDE,
    })
  }

  private async issueSession(user: { id: string; userRoles: { role: { code: string } }[]; member: { id: string } | null }): Promise<LoginResult> {
    const roles = user.userRoles.map((ur) => ur.role.code)
    const memberId = user.member?.id ?? null
    const accessToken = this.jwt.sign({ sub: user.id, roles, memberId }, { expiresIn: ACCESS_TOKEN_TTL })
    const refreshToken = await this.issueRefreshToken(user.id)
    return { accessToken, refreshToken, user: { id: user.id, roles, memberId } }
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(48).toString('hex')
    const tokenHash = this.hashToken(raw)
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000) },
    })
    return raw
  }

  /** Refresh tokens are opaque and hashed at rest with a fast, deterministic hash
   *  (not bcrypt — we need to look them up by exact value, not compare-and-salt). */
  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex')
  }

  private async getOrCreateMemberRole() {
    const existing = await this.prisma.role.findUnique({ where: { code: 'MEMBER' } })
    if (existing) return existing
    return this.prisma.role.create({ data: { code: 'MEMBER', label: 'Member', isSystem: true } })
  }
}

function otpProblem(check: Exclude<OtpCheck, 'ok'>): string {
  if (check === 'too_many') return 'Too many wrong codes. Ask for a new one.'
  if (check === 'wrong') return 'That code is not right. Check it and try again.'
  return 'This code has expired or was already used. Ask for a new one.'
}

function lockedMessage(until: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000))
  return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or sign in with a code sent to your mobile.`
}
