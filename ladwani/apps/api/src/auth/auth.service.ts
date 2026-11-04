import { createHash, randomBytes, randomInt } from 'crypto'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
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
import { CodeDeliveryService, type CodeChannel } from './code-delivery.service'
import type { CodePurpose, Lang } from './code-email'
import { OTP_MAX_TRIES, OTP_SENDS_PER_HOUR, OTP_TTL_MINUTES } from './otp-rules'

const ACCESS_TOKEN_TTL = '15m'
const REFRESH_TOKEN_TTL_DAYS = 30
export const MAX_FAILED_ATTEMPTS = 5
export const LOCK_MINUTES = 15
const BCRYPT_COST = 12

export { OTP_MAX_TRIES, OTP_SENDS_PER_HOUR, OTP_TTL_MINUTES }

/**
 * verification_tokens.type values, one per purpose and channel. Codes go by
 * email (owner's decision, 4 Nov 2026: SMS is on hold); the MOBILE_* and
 * PASSWORD_RESET (by SMS: the name predates email codes) paths stay for when
 * SMS comes back. Every try at a code is recorded as an OTP_MISS row whose
 * token_hash holds the id of that code (a right one removes its row again),
 * so tries are counted per code without a schema change.
 */
export const OTP_TYPES = {
  EMAIL_VERIFY: 'EMAIL_VERIFY',
  EMAIL_LOGIN: 'EMAIL_LOGIN',
  EMAIL_PASSWORD_RESET: 'EMAIL_PASSWORD_RESET',
  MOBILE_VERIFY: 'MOBILE_VERIFY',
  MOBILE_LOGIN: 'MOBILE_LOGIN',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const
type OtpType = (typeof OTP_TYPES)[keyof typeof OTP_TYPES]
const OTP_MISS = 'OTP_MISS'
/** All of them count towards OTP_SENDS_PER_HOUR, whichever channel they went by. */
const SENT_OTP_TYPES: string[] = Object.values(OTP_TYPES)
/** Where each type of code was sent, so a right code proves that inbox (or phone) is the person's. */
const CHANNEL_OF: Record<OtpType, CodeChannel> = {
  EMAIL_VERIFY: 'email',
  EMAIL_LOGIN: 'email',
  EMAIL_PASSWORD_RESET: 'email',
  MOBILE_VERIFY: 'sms',
  MOBILE_LOGIN: 'sms',
  PASSWORD_RESET: 'sms',
}
const VERIFIED_FIELD = { email: 'emailVerified', sms: 'mobileVerified' } as const

/** Who a code is for: an email address, or (while SMS is on hold, only with a provider or on dev) a mobile number. Email wins when both are given. */
export interface CodeTarget {
  email?: string
  mobile?: string
}

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
  /** Compared against when no account matches, so an unknown sign-in takes as long as a wrong password. */
  private noSuchUserHash?: Promise<string>

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private delivery: CodeDeliveryService,
  ) {}

  /**
   * Creates the account and emails it a code, which verifies the email and
   * signs the person in (loginWithOtp). The mobile number is kept on the
   * account but not verified while SMS is on hold. `devOtp` only as
   * CodeDeliveryService allows: dev tier or a local run, with no mail provider.
   */
  async register(dto: RegisterDto, lang: Lang = 'en'): Promise<{ userId: string; devOtp?: string }> {
    // Before anything is written: where nobody could receive the code, say so.
    this.delivery.assertAvailable('email')

    // Stored and compared lower-cased. PostgreSQL compares exactly, so without
    // this Asha@x.com and asha@x.com would be two accounts and a sign-in with the
    // other capitalisation would fail.
    const email = normalizeEmail(dto.email)
    if (!email) throw new BadRequestException('Enter a valid email address')
    // The email first: an unfinished earlier sign-up with it carries on with a
    // sign-in code (web /sign-up), so the web needs to know which one is taken.
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw taken('EMAIL_TAKEN', 'An account with this email already exists.')
    }
    if (await this.prisma.user.findUnique({ where: { mobile: dto.mobile } })) {
      throw taken('MOBILE_TAKEN', 'An account with this mobile number already exists.')
    }

    // No password yet: a random one nobody knows. Email + code signs this
    // account in, and "Forgot password" sets a real one.
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
          type: OTP_TYPES.EMAIL_VERIFY,
          tokenHash: otpHash,
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
        },
      })

      return user.id
    })

    // A failed send answers 503; the account stays, and asking again (409,
    // then a sign-in code) carries on from here.
    const sent = await this.delivery.deliver('email', email, otp, 'sign-up', lang)
    return { userId, ...sent }
  }

  /** Verifies the email (or, later, the mobile) with the sign-up code. */
  async verifyOtp(dto: VerifyOtpDto): Promise<{ verified: true }> {
    const { check, type } = await this.spendOtp(dto.userId, [OTP_TYPES.EMAIL_VERIFY, OTP_TYPES.MOBILE_VERIFY], dto.otp)
    if (check === 'none') throw new NotFoundException('No pending verification for this account.')
    if (check !== 'ok' || !type) throw new BadRequestException(otpProblem(check === 'ok' ? 'expired' : check))
    await this.markVerified(dto.userId, CHANNEL_OF[type])
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

  // ── Sign-in with a code (by email; by SMS once it is back) ─────────

  /**
   * Sends a sign-in code to the email (or mobile) when it belongs to an
   * account that may sign in. The caller answers the same either way, and no
   * mail goes to an address without an account; only `devOtp` (dev tier or a
   * local run, no provider) differs. 503 for everyone alike where nothing can
   * deliver the code.
   */
  async sendLoginOtp(target: CodeTarget, lang: Lang = 'en'): Promise<{ devOtp?: string }> {
    const { channel, where } = codeTarget(target)
    this.delivery.assertAvailable(channel)
    const user = await this.prisma.user.findFirst({ where: { ...where, deletedAt: null } })
    if (!user || BLOCKED_STATUSES.has(user.status)) return {}
    const to = channel === 'email' ? user.email : user.mobile
    if (!to) return {}
    return this.issueOtp(user.id, channel === 'email' ? OTP_TYPES.EMAIL_LOGIN : OTP_TYPES.MOBILE_LOGIN, to, 'sign-in', lang)
  }

  /**
   * Signs in with a code from sendLoginOtp (or the one sent at sign-up, which
   * proves the same thing: this person holds the inbox, or the phone). A
   * password lock does not apply: it stops password guessing, and codes have
   * their own limits. An email code only works with that email, a mobile code
   * only with that number.
   */
  async loginWithOtp(target: CodeTarget, otp: string): Promise<LoginResult> {
    const { channel, where } = codeTarget(target)
    const user = await this.prisma.user.findFirst({ where: { ...where, deletedAt: null }, include: SESSION_USER_INCLUDE })
    if (!user) {
      await this.spendCompareTime(otp)
      throw new UnauthorizedException(otpProblem('wrong'))
    }
    if (BLOCKED_STATUSES.has(user.status)) throw new ForbiddenException('Account suspended. Contact an administrator.')

    const types = channel === 'email' ? [OTP_TYPES.EMAIL_LOGIN, OTP_TYPES.EMAIL_VERIFY] : [OTP_TYPES.MOBILE_LOGIN, OTP_TYPES.MOBILE_VERIFY]
    const check = await this.checkOtp(user.id, types, otp)
    if (check !== 'ok') throw new UnauthorizedException(otpProblem(check))

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        [VERIFIED_FIELD[channel]]: true,
        ...(user.status === 'PENDING' ? { status: 'ACTIVE' } : {}),
      },
    })
    return this.issueSession(user)
  }

  // ── Forgot password ─────────────────────────────────────────────────

  /**
   * Sends a reset code to the account's email (found by its email or mobile).
   * The same answer whether or not the account exists. An account with no
   * email gets nothing while SMS is on hold, and is answered the same.
   */
  async requestPasswordReset(identifier: string, lang: Lang = 'en'): Promise<{ devOtp?: string }> {
    const byEmail = this.delivery.mode('email')
    const bySms = this.delivery.mode('sms')
    if (byEmail === 'off' && bySms === 'off') throw this.delivery.unavailable('email')
    const user = await this.findByIdentifier(identifier)
    if (!user || BLOCKED_STATUSES.has(user.status)) return {}
    if (user.email && byEmail !== 'off') return this.issueOtp(user.id, OTP_TYPES.EMAIL_PASSWORD_RESET, user.email, 'reset', lang)
    if (user.mobile && bySms !== 'off') return this.issueOtp(user.id, OTP_TYPES.PASSWORD_RESET, user.mobile, 'reset', lang)
    return {}
  }

  /** Sets a new password with a reset code, clears any lock and ends every session. */
  async resetPassword(identifier: string, otp: string, password: string): Promise<{ reset: true }> {
    const user = await this.findByIdentifier(identifier)
    if (!user || BLOCKED_STATUSES.has(user.status)) {
      await this.spendCompareTime(otp)
      throw new BadRequestException(otpProblem('wrong'))
    }

    const { check, type } = await this.spendOtp(user.id, [OTP_TYPES.EMAIL_PASSWORD_RESET, OTP_TYPES.PASSWORD_RESET], otp)
    if (check !== 'ok' || !type) throw new BadRequestException(otpProblem(check === 'ok' ? 'expired' : check))

    const passwordHash = await hash(password, BCRYPT_COST)
    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        // The code reached this inbox (or phone), so that is verified too.
        data: { passwordHash, failedAttempts: 0, lockedUntil: null, [VERIFIED_FIELD[CHANNEL_OF[type]]]: true },
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
   * that type, and sends it to `to` (CodeDeliveryService). Past
   * OTP_SENDS_PER_HOUR codes in the last hour nothing is sent, and the caller
   * still answers as if it had been.
   */
  private async issueOtp(userId: string, type: OtpType, to: string, purpose: CodePurpose, lang: Lang): Promise<{ devOtp?: string }> {
    const otp = this.newOtp()
    const tokenHash = await hash(otp, BCRYPT_COST)
    const issued = await this.prisma.$transaction(async (tx) => {
      // One send at a time per account: requests sent together wait on this
      // row lock, so each counts the codes the others issued and the limit
      // holds (every send is a real email now).
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
      const now = new Date()
      const recent = await tx.verificationToken.count({
        where: { userId, type: { in: SENT_OTP_TYPES }, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } },
      })
      if (recent >= OTP_SENDS_PER_HOUR) return false
      await tx.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: now } })
      await tx.verificationToken.create({
        data: { userId, type, tokenHash, expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000) },
      })
      return true
    })
    if (!issued) return {}
    return this.delivery.deliver(CHANNEL_OF[type], to, otp, purpose, lang)
  }

  /**
   * Checks `otp` against the newest live code of `types` and uses it up when it
   * matches. Each try is recorded BEFORE the comparison, so requests sent in
   * parallel cannot buy one code more than OTP_MAX_TRIES comparisons.
   */
  async checkOtp(userId: string, types: OtpType[], otp: string): Promise<OtpCheck> {
    return (await this.spendOtp(userId, types, otp)).check
  }

  /** checkOtp, also naming the type of the code it checked (so the caller knows where it was sent). */
  private async spendOtp(userId: string, types: OtpType[], otp: string): Promise<{ check: OtpCheck; type?: OtpType }> {
    const token = await this.prisma.verificationToken.findFirst({
      where: { userId, type: { in: types }, usedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (!token) return { check: 'none' }
    const type = token.type as OtpType
    if (token.expiresAt < new Date()) return { check: 'expired', type }

    const attempt = await this.prisma.verificationToken.create({
      data: { userId, type: OTP_MISS, tokenHash: token.id, expiresAt: token.expiresAt, usedAt: new Date() },
    })
    const tries = await this.prisma.verificationToken.count({ where: { userId, type: OTP_MISS, tokenHash: token.id } })
    const voidCode = () => this.prisma.verificationToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } })
    if (tries > OTP_MAX_TRIES) {
      await voidCode()
      return { check: 'too_many', type }
    }

    if (await compare(otp, token.tokenHash)) {
      await this.prisma.verificationToken.delete({ where: { id: attempt.id } })
      // Single use, even under two requests at once: only one update claims it.
      const claimed = await voidCode()
      return { check: claimed.count === 1 ? 'ok' : 'expired', type }
    }
    if (tries >= OTP_MAX_TRIES) {
      await voidCode()
      return { check: 'too_many', type }
    }
    return { check: 'wrong', type }
  }

  /** A bcrypt comparison that can never match, so "no such account" takes as long as a wrong answer. */
  private async spendCompareTime(value: string): Promise<void> {
    this.noSuchUserHash ??= hash(randomBytes(16).toString('hex'), BCRYPT_COST)
    await compare(value, await this.noSuchUserHash)
  }

  private newOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0')
  }

  /** A verified email (or mobile) activates a new account; it never lifts a suspension. */
  private async markVerified(userId: string, channel: CodeChannel) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('No pending verification for this account.')
    await this.prisma.user.update({
      where: { id: userId },
      data: { [VERIFIED_FIELD[channel]]: true, ...(user.status === 'PENDING' ? { status: 'ACTIVE' } : {}) },
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

/** 409 naming which of the two is taken, for the web's sign-up (reason EMAIL_TAKEN or MOBILE_TAKEN). */
function taken(reason: 'EMAIL_TAKEN' | 'MOBILE_TAKEN', message: string): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', message, reason })
}

/** Where a code goes, and how to find its account. Never matches "no email" or "no mobile". */
function codeTarget(target: CodeTarget): { channel: CodeChannel; where: { email: string } | { mobile: string } } {
  const email = normalizeEmail(target.email)
  if (email) return { channel: 'email', where: { email } }
  const mobile = typeof target.mobile === 'string' ? (normalizeMobile(target.mobile) as string) : ''
  if (mobile) return { channel: 'sms', where: { mobile } }
  throw new BadRequestException('Enter your email address')
}

function otpProblem(check: Exclude<OtpCheck, 'ok'>): string {
  if (check === 'too_many') return 'Too many wrong codes. Ask for a new one.'
  if (check === 'wrong') return 'That code is not right. Check it and try again.'
  return 'This code has expired or was already used. Ask for a new one.'
}

function lockedMessage(until: Date): string {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000))
  return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or sign in with a code sent to your email.`
}
