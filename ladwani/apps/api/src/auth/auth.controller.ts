import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { AuthService, HubSignInResult, LoginResult, OTP_TTL_MINUTES } from './auth.service'
import { CodeDeliveryService } from './code-delivery.service'
import { SignUpService } from './sign-up.service'
import { langOf } from './code-email'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { OtpLoginDto, SendOtpDto } from './dto/otp.dto'
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto'
import { SameOriginGuard } from './same-origin.guard'
import { appBase, clearSessionCookie, readSessionCookie, setSessionCookie } from './session-cookie'
import { clientAddress } from '../common/visitor-throttler.guard'
import { PROJECT_STATE_HEADER, hubContextOf, verifyHubIdentity } from './hub-identity'
import { ProjectStateService } from './project-state.service'

const FIFTEEN_MINUTES = 15 * 60 * 1000

/** The language the shell is showing (cookie k_lang), for the email with the code. English unless chosen. */
const langFrom = (req: Request) => langOf(req.cookies?.k_lang)

/**
 * Under the hub (a valid identity on this request, hub-identity.ts): only the
 * session of the LadWani user joined to the hub person's id counts.
 */
const hubOnly = (req: Request) => {
  const hub = hubContextOf(req)
  return hub ? { userId: hub.localUserId } : undefined
}

/** The shell's account menu links, in the language the shell is showing (cookie k_lang). */
const PROFILE_LABEL: Record<string, string> = { en: 'My profile', mr: 'माझी प्रोफाइल', hi: 'मेरी प्रोफ़ाइल' }

/**
 * LadWani's own sign-in, end to end: its users, its codes, its session cookie
 * (session-cookie.ts), and the bkesari hub's sign-in on top of it (POST
 * /auth/hub, D-039). Every route refuses cross-site requests (SameOriginGuard).
 * One-time codes go by email (CodeDeliveryService). An answer carries the code
 * itself (`devOtp`) only on the dev tier or a local run with no mail provider
 * configured: AuthService returns it only then, and it is passed on as it is.
 * Never on the test or production tiers.
 */
@Controller('auth')
@UseGuards(SameOriginGuard)
export class AuthController {
  constructor(
    private auth: AuthService,
    private delivery: CodeDeliveryService,
    private signUp: SignUpService,
    private states: ProjectStateService,
  ) {}

  /**
   * The bkesari hub's sign-in (docs/design/bkesari-id.md, D-039). The web app
   * calls it first on every load. With a valid signed identity on this request
   * (hub-identity.ts: only the hub, in this process, can add one; it removes
   * any a client sent), it signs that person in without a password, exactly as
   * /auth/login does: the lw_sid cookie and { data: { accessToken, user } },
   * plus `created` when it made the LadWani account. Whatever session this
   * browser held ends first (AuthService.hubSignIn), and the answer carries
   * X-Bkesari-Project-State for the account as it now is.
   *
   * Refused: 409 when the email belongs to a LadWani account it may not take
   * (never confirmed, or joined to another bkesari ID), 403 for a suspended or
   * removed account; `reason` names which. The session cookie is cleared then too.
   *
   * No valid identity (the hub's secret unset here, or anything wrong with
   * the headers): { data: null } and nothing changes; LadWani's own sign-in
   * works as before.
   */
  @Post('hub')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  async hub(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store')
    const identity = hubContextOf(req)?.identity ?? verifyHubIdentity(req.headers)
    if (!identity) return { data: null }
    const presented = readSessionCookie(req)
    let result: HubSignInResult
    try {
      result = await this.auth.hubSignIn(identity, presented, clientAddress(req))
    } catch (err) {
      if (presented) clearSessionCookie(req, res)
      throw err
    }
    res.setHeader(PROJECT_STATE_HEADER, await this.states.ofUser(result.user.id))
    const { data } = this.signedIn(req, res, result)
    return { data: { ...data, created: result.created } }
  }

  /**
   * Creates the account and emails it a code (409 with reason EMAIL_TAKEN or
   * MOBILE_TAKEN when one is in use; the mobile is optional, D-037). 400 for an
   * address on the built-in administrators' domain.
   */
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const { userId, devOtp } = await this.auth.register(dto, langFrom(req))
    return {
      data: { userId, sent: true, expiresInMinutes: OTP_TTL_MINUTES, message: 'Account created. Enter the code we emailed you to continue.' },
      ...(devOtp ? { devOtp } : {}),
    }
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const result = await this.auth.verifyOtp(dto)
    return { data: result }
  }

  /**
   * Email or mobile + password, or a built-in administrator's username +
   * the built-in password (D-036; AuthService.builtinLogin, whose own limits
   * count per client address and per username, on top of this route's).
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.signedIn(req, res, await this.auth.login(dto, clientAddress(req)))
  }

  /**
   * Sends a sign-in code to { email } (or { mobile }, kept for when SMS is
   * back). The same answer whether or not the address has an account; 503 for
   * everyone where nothing can deliver it.
   */
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  async sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) {
    const byEmail = dto.email !== undefined || dto.mobile === undefined
    const { devOtp } = await this.auth.sendLoginOtp(byEmail ? { email: dto.email } : { mobile: dto.mobile }, langFrom(req))
    return {
      data: {
        sent: true,
        expiresInMinutes: OTP_TTL_MINUTES,
        message: byEmail ? 'If this email has a LadWani account, a code is on its way.' : 'If this number has a LadWani account, a code is on its way.',
      },
      ...(devOtp ? { devOtp } : {}),
    }
  }

  @Post('otp/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  async otpLogin(@Body() dto: OtpLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const byEmail = dto.email !== undefined || dto.mobile === undefined
    return this.signedIn(req, res, await this.auth.loginWithOtp(byEmail ? { email: dto.email } : { mobile: dto.mobile }, dto.otp))
  }

  /** Sends a reset code to the account's email. The same answer whether or not the account exists. */
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const { devOtp } = await this.auth.requestPasswordReset(dto.identifier, langFrom(req))
    return {
      data: { sent: true, expiresInMinutes: OTP_TTL_MINUTES, message: 'If an account matches, a code is on its way to its email address.' },
      ...(devOtp ? { devOtp } : {}),
    }
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.resetPassword(dto.identifier, dto.otp, dto.password)
    // Every session ended, this browser's included.
    clearSessionCookie(req, res)
    return { data: result }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readSessionCookie(req)
    if (!token) throw new UnauthorizedException('No session found.')

    let result: LoginResult
    try {
      result = await this.auth.refresh(token, hubOnly(req))
    } catch (err) {
      clearSessionCookie(req, res)
      throw err
    }
    return this.signedIn(req, res, result)
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readSessionCookie(req)
    if (token) await this.auth.logout(token)
    clearSessionCookie(req, res)
    return { data: { loggedOut: true } }
  }

  /**
   * For the bkesari app shell's account menu (portal/public/shared/menu.js):
   * who is signed in to LadWani, read from the session cookie without rotating
   * it. Not wrapped in { data }: the shell reads this shape as it is. The user
   * also carries its role codes, its account status (PENDING = email or mobile
   * not confirmed yet) and `verification`, where the operator's check of its ID
   * proof stands (SignUpService.status, as the /pending screen shows it:
   * NOT_SUBMITTED, UNDER_REVIEW, VERIFIED or NEEDS_ATTENTION). The hub's "My
   * projects and access" page shows the access level from them.
   * Also, for LadWani's own sign-in screens, which code channels have a
   * provider: mailLive (MAIL_HOST is set) and smsLive (false while SMS is on
   * hold; the screens offer mobile codes only when it is true).
   */
  @Get('session')
  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store')
    const base = appBase()
    const live = { mailLive: this.delivery.live('email'), smsLive: this.delivery.live('sms') }
    // Under the hub, another person's LadWani session counts as none (D-039).
    const owner = await this.auth.sessionOwner(readSessionCookie(req), hubOnly(req))
    // Signed out is an answer, not an error: a 401 here would be logged to the
    // browser's console on every page a visitor opens.
    if (!owner) return { user: null, signInUrl: `${base}/sign-in/`, ...live }
    const lang = langFrom(req)
    const verification = (await this.signUp.status(owner.userId)).idProof.state
    return {
      user: { ...owner.person, verification },
      signOut: { url: `${base}/api/v1/auth/logout`, next: `${base}/sign-in` },
      links: [{ label: PROFILE_LABEL[lang] ?? PROFILE_LABEL.en, href: `${base}/profile/edit/` }],
      ...live,
    }
  }

  private signedIn(req: Request, res: Response, result: LoginResult) {
    setSessionCookie(req, res, result.refreshToken)
    return { data: { accessToken: result.accessToken, user: result.user } }
  }
}
