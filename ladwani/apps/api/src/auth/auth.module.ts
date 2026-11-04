import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SignUpController } from './sign-up.controller'
import { SignUpService } from './sign-up.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { ApprovalsModule } from '../common/approvals/approvals.module'
import { MailModule } from '../mail/mail.module'
import { CodeDeliveryService } from './code-delivery.service'
import { env } from '../common/env'

/**
 * LadWani's accounts: its own users table and session cookie, nothing shared
 * with the bkesari hub or any other project. One-time codes go by email
 * (MailModule, SMTP).
 */
@Module({
  imports: [
    PassportModule,
    ApprovalsModule,
    MailModule,
    JwtModule.register({
      secret: env('JWT_SECRET') ?? 'dev-secret-change-in-production',
    }),
  ],
  controllers: [AuthController, SignUpController],
  providers: [AuthService, SignUpService, CodeDeliveryService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
