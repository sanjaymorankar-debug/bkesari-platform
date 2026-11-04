import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { JwtPayload } from './strategies/jwt.strategy'
import { SameOriginGuard } from './same-origin.guard'
import { SignUpService } from './sign-up.service'
import { CompleteSignUpDto } from './dto/complete-sign-up.dto'

@Controller('auth/sign-up')
@UseGuards(SameOriginGuard, JwtAuthGuard)
export class SignUpController {
  constructor(private signUp: SignUpService) {}

  /** Sign-up step 4: hands the ID proof to the review queue and records consent. */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  async complete(@CurrentUser() user: JwtPayload, @Body() dto: CompleteSignUpDto) {
    return { data: await this.signUp.complete(user.sub, dto) }
  }

  /** "Approval pending": where the person's ID proof review stands. */
  @Get('status')
  async status(@CurrentUser() user: JwtPayload) {
    return { data: await this.signUp.status(user.sub) }
  }
}
