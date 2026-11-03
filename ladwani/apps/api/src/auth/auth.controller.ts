import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { AuthService, LoginResult, OTP_TTL_MINUTES } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { OtpLoginDto, SendOtpDto } from './dto/otp.dto'
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto'
import { SameOriginGuard } from './same-origin.guard'
import { appBase, clearSessionCookie, readSessionCookie, setSessionCookie } from './session-cookie'

const FIFTEEN_MINUTES = 15 * 60 * 1000

/** Dev-only: no SMS provider is wired yet. Never present in a production response. */
function devOnly(otp: string | undefined): { devOtp?: string } {
  return process.env.NODE_ENV !== 'production' && otp ? { devOtp: otp } : {}
}

/** The shell's account menu links, in the language the shell is showing (cookie k_lang). */
const PROFILE_LABEL: Record<string, string> = { en: 'My profile', mr: 'माझी प्रोफाइल', hi: 'मेरी प्रोफ़ाइल' }

/**
 * LadWani's own sign-in, end to end: its users, its codes, its session cookie
 * (session-cookie.ts). Every route refuses cross-site requests (SameOriginGuard).
 */
@Controller('auth')
@UseGuards(SameOriginGuard)
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async register(@Body() dto: RegisterDto) {
    const { userId, otpForDev } = await this.auth.register(dto)
    return {
      data: { userId, message: 'Account created. Verify your mobile to continue.' },
      ...devOnly(otpForDev),
    }
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const result = await this.auth.verifyOtp(dto)
    return { data: result }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.signedIn(req, res, await this.auth.login(dto))
  }

  /** Sends a sign-in code. The same answer whether or not the number has an account. */
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  async sendOtp(@Body() dto: SendOtpDto) {
    const { otpForDev } = await this.auth.sendLoginOtp(dto.mobile)
    return {
      data: { sent: true, expiresInMinutes: OTP_TTL_MINUTES, message: 'If this number has a LadWani account, a code is on its way.' },
      ...devOnly(otpForDev),
    }
  }

  @Post('otp/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES } })
  async otpLogin(@Body() dto: OtpLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.signedIn(req, res, await this.auth.loginWithOtp(dto.mobile, dto.otp))
  }

  /** Sends a reset code to the account's mobile. The same answer whether or not the account exists. */
  @Post('password/forgot')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: FIFTEEN_MINUTES } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const { otpForDev } = await this.auth.requestPasswordReset(dto.identifier)
    return {
      data: { sent: true, expiresInMinutes: OTP_TTL_MINUTES, message: 'If an account matches, a code is on its way to its mobile number.' },
      ...devOnly(otpForDev),
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
      result = await this.auth.refresh(token)
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
   * it. Not wrapped in { data }: the shell reads this shape as it is.
   */
  @Get('session')
  @Throttle({ default: { limit: 60, ttl: 60 * 1000 } })
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store')
    const base = appBase()
    const person = await this.auth.sessionPerson(readSessionCookie(req))
    // Signed out is an answer, not an error: a 401 here would be logged to the
    // browser's console on every page a visitor opens.
    if (!person) return { user: null, signInUrl: `${base}/sign-in/` }
    const lang = String(req.cookies?.k_lang ?? 'en')
    return {
      user: person,
      signOut: { url: `${base}/api/v1/auth/logout`, next: `${base}/sign-in` },
      links: [{ label: PROFILE_LABEL[lang] ?? PROFILE_LABEL.en, href: `${base}/profile/edit/` }],
    }
  }

  private signedIn(req: Request, res: Response, result: LoginResult) {
    setSessionCookie(req, res, result.refreshToken)
    return { data: { accessToken: result.accessToken, user: result.user } }
  }
}
