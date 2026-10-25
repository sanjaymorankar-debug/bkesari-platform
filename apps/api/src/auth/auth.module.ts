import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { HubJwks } from './hub-token'
import { JwtStrategy } from './strategies/jwt.strategy'

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, { provide: HubJwks, useFactory: () => new HubJwks() }],
  exports: [AuthService],
})
export class AuthModule {}
