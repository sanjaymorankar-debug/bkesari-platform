import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import type { Request } from 'express'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { env } from '../../common/env'
import { HUB_OTHER_SESSION, hubContextOf } from '../hub-identity'

export interface JwtPayload {
  sub: string
  roles: string[]
  memberId: string | null
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: env('JWT_SECRET') ?? 'dev-secret-change-in-production',
      passReqToCallback: true,
    })
  }

  /**
   * Whatever this returns becomes `request.user`. When the request carries
   * the bkesari hub's identity (HubIdentityMiddleware), the token must be the
   * one of the LadWani user joined to that hub id: a token left from someone
   * else's session in this browser is refused (401), so the hub person never
   * acts as anyone else (docs/design/bkesari-id.md §3).
   */
  async validate(req: Request, payload: JwtPayload): Promise<JwtPayload> {
    const hub = hubContextOf(req)
    if (hub && hub.localUserId !== payload.sub) throw new UnauthorizedException(HUB_OTHER_SESSION)
    return payload
  }
}
