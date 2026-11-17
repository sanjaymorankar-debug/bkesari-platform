import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { SignUpService } from './sign-up.service'
import type { ProjectState } from './hub-identity'

/** LadWani's own staff: the people who verify others, whom no queue verifies. */
const STAFF_ROLES = new Set(['OPERATOR', 'ADMIN'])

const STATE_SELECT = {
  id: true,
  status: true,
  deletedAt: true,
  userRoles: { select: { role: { select: { code: true } } } },
} as const

interface StateUser {
  id: string
  status: string
  deletedAt: Date | null
  userRoles: { role: { code: string } }[]
}

/**
 * LadWani's second step for the bkesari hub (docs/design/bkesari-id.md §2):
 * after the hub grants someone LadWani, the grant reads "Approved — awaiting
 * LadWani verification" until LadWani reports `X-Bkesari-Project-State: verified`.
 *
 * What "verified" (LadWani's verification complete) means, exactly:
 *
 *   1. the person has a LadWani account linked to their hub id
 *      (users.hub_user_id), that account is ACTIVE and not deleted; and
 *   2. either
 *      a. their ID proof check is done: the newest `member.id_proof.verify`
 *         approval they submitted (sign-up step 4, POST /auth/sign-up/complete)
 *         is APPROVED in the Operator/Admin approval queue (POST
 *         /approvals/:id/decide). This is the same rule that shows them
 *         "Verified" on their own /pending page (SignUpService.status), so
 *         sending a new ID proof after approval makes it pending again until
 *         that one is approved too; or
 *      b. they hold LadWani's OPERATOR or ADMIN role (the staff who do the
 *         verifying, and the built-in administrators).
 *
 * Anything else is "pending": no linked account yet, no ID proof sent, one
 * waiting for review, returned or rejected, and a PENDING, SUSPENDED or
 * BLOCKED account.
 *
 * Today one Operator's (or Admin's) approval of the ID proof completes it: the
 * approval engine records a single reviewer per approval. If two different
 * Operators must both approve, that is a change to the approval queue, and
 * then to rule 2a here.
 */
@Injectable()
export class ProjectStateService {
  constructor(
    private prisma: PrismaService,
    private signUp: SignUpService,
  ) {}

  /** The LadWani user linked to this hub id (null when none is) and their state. */
  async forHubUser(hubUserId: string): Promise<{ userId: string | null; state: ProjectState }> {
    const user = await this.prisma.user.findUnique({ where: { hubUserId }, select: STATE_SELECT })
    if (!user) return { userId: null, state: 'pending' }
    return { userId: user.id, state: await this.stateOf(user) }
  }

  /** The state of this LadWani user. */
  async ofUser(userId: string): Promise<ProjectState> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: STATE_SELECT })
    return user ? this.stateOf(user) : 'pending'
  }

  private async stateOf(user: StateUser): Promise<ProjectState> {
    if (user.deletedAt || user.status !== 'ACTIVE') return 'pending'
    if (user.userRoles.some((ur) => STAFF_ROLES.has(ur.role.code))) return 'verified'
    const { idProof } = await this.signUp.status(user.id)
    return idProof.state === 'VERIFIED' ? 'verified' : 'pending'
  }
}
