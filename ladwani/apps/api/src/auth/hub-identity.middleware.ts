import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { PROJECT_STATE_HEADER, setHubContext, verifyHubIdentity } from './hub-identity'
import { ProjectStateService } from './project-state.service'

/**
 * Runs on every API request (AuthModule binds it to all routes). When the
 * request carries a valid hub identity (hub-identity.ts) it:
 *
 *   - sets `X-Bkesari-Project-State: verified | pending` on the response
 *     (ProjectStateService says what "verified" means), whatever the answer
 *     turns out to be, errors included; POST /auth/hub sets it again after
 *     signing the person in, so that answer reflects any account it linked;
 *   - records who the hub says this is, and which LadWani user is linked to
 *     that hub id, for JwtStrategy: on such a request only that user's own
 *     access token is believed.
 *
 * Without a valid identity it does nothing at all. A database failure here
 * fails the request (500) rather than let it through unchecked.
 */
@Injectable()
export class HubIdentityMiddleware implements NestMiddleware {
  constructor(private states: ProjectStateService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const identity = verifyHubIdentity(req.headers)
    if (identity) {
      const { userId, state } = await this.states.forHubUser(identity.user)
      setHubContext(req, { identity, localUserId: userId })
      res.setHeader(PROJECT_STATE_HEADER, state)
    }
    next()
  }
}
