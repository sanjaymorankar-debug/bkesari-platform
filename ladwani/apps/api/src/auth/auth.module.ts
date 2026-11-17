import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
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
import { HubIdentityMiddleware } from './hub-identity.middleware'
import { ProjectStateService } from './project-state.service'

/**
 * LadWani's accounts: its own users table and session cookie. One-time codes
 * go by email (MailModule, SMTP). Inside the bkesari hub, the hub's signed
 * identity headers (hub-identity.ts) sign the person in to their own LadWani
 * account (POST /auth/hub), and HubIdentityMiddleware, on every API route,
 * reports LadWani's verification of them (X-Bkesari-Project-State) and keeps
 * any other person's session from being used on their requests.
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
  providers: [AuthService, SignUpService, CodeDeliveryService, JwtStrategy, ProjectStateService],
  exports: [AuthService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HubIdentityMiddleware).forRoutes('*')
  }
}
