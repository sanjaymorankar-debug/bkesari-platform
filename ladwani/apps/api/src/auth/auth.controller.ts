import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { AuthService, LoginResult } from './auth.service'
import { RegisterDto } from './dto/register.dto'
import { LoginDto } from './dto/login.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { HUB_TOKEN_HEADER } from './hub-token'

const REFRESH_COOKIE = 'refreshToken'
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1000 } })
  async register(@Body() dto: RegisterDto) {
    const { userId, otpForDev } = await this.auth.register(dto)
    return {
      data: { userId, message: 'Account created. Verify your mobile to continue.' },
      // Dev-only: no SMS provider wired yet (docs/13-development-roadmap.md M0 scope).
      // Never present in a production response.
      ...(process.env.NODE_ENV !== 'production' ? { devOtp: otpForDev } : {}),
    }
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const result = await this.auth.verifyOtp(dto)
    return { data: result }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto)
    this.setRefreshCookie(res, result.refreshToken)
    return { data: { accessToken: result.accessToken, user: result.user } }
  }

  /** Sign in with the hub's X-Bkesari-Token, which the hub adds to every forwarded request. */
  @Post('hub')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60 * 1000 } })
  async hub(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const header = req.headers[HUB_TOKEN_HEADER]
    const result = await this.auth.hubLogin(Array.isArray(header) ? header[0] : header)
    this.setRefreshCookie(res, result.refreshToken)
    return { data: { accessToken: result.accessToken, user: result.user } }
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE]
    if (!token) throw new UnauthorizedException('No session found.')

    const result: LoginResult = await this.auth.refresh(token)
    this.setRefreshCookie(res, result.refreshToken)
    return { data: { accessToken: result.accessToken, user: result.user } }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE]
    if (token) await this.auth.logout(token)
    res.clearCookie(REFRESH_COOKIE)
    return { data: { loggedOut: true } }
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    })
  }
}
