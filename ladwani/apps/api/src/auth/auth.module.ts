import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { SignUpController } from './sign-up.controller'
import { SignUpService } from './sign-up.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { ApprovalsModule } from '../common/approvals/approvals.module'
import { env } from '../common/env'

/**
 * LadWani's accounts: its own users table and session cookie, nothing shared
 * with the bkesari hub or any other project.
 */
@Module({
  imports: [
    PassportModule,
    ApprovalsModule,
    JwtModule.register({
      secret: env('JWT_SECRET') ?? 'dev-secret-change-in-production',
    }),
  ],
  controllers: [AuthController, SignUpController],
  providers: [AuthService, SignUpService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
