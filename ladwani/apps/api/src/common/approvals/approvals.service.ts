import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

type Db = PrismaService | Prisma.TransactionClient

export interface SubmitApprovalInput {
  actionCode: string
  entityType?: string
  entityId?: string
  oldValue?: unknown
  newValue?: unknown
  submittedBy: string
}

export type ApprovalDecision = 'APPROVED' | 'REJECTED' | 'RETURNED'

/**
 * Generic approval engine — docs/12-approval-workflow.md. This module only
 * owns the DRAFT→SUBMITTED→UNDER_REVIEW→(APPROVED|REJECTED|RETURNED) state
 * machine and the approval_rules lookup. Applying an APPROVED change to the
 * actual entity is the owning module's job — see ApprovalDispatchService,
 * which maps actionCode to the right module method after decide() resolves.
 * Every method takes an optional Prisma transaction client so a caller can
 * fold the submit/decide step into a larger atomic write.
 */
@Injectable()
export class ApprovalsService {
  constructor(private prisma: PrismaService) {}

  async submit(input: SubmitApprovalInput, db: Db = this.prisma) {
    const rule = await db.approvalRule.findUnique({ where: { actionCode: input.actionCode } })
    const requiresApproval = rule?.requiresApproval ?? true

    return db.approval.create({
      data: {
        actionCode: input.actionCode,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValue: input.oldValue as never,
        newValue: input.newValue as never,
        submittedBy: input.submittedBy,
        status: requiresApproval ? 'SUBMITTED' : 'APPROVED',
      },
    })
  }

  async startReview(id: string, db: Db = this.prisma) {
    const approval = await this.mustFind(id, db)
    if (approval.status !== 'SUBMITTED') {
      throw new ConflictException('Only a submitted approval can move to review')
    }
    return db.approval.update({ where: { id }, data: { status: 'UNDER_REVIEW' } })
  }

  async decide(id: string, decision: ApprovalDecision, reviewedBy: string, reviewNote?: string, db: Db = this.prisma) {
    const approval = await this.mustFind(id, db)
    if (approval.status !== 'SUBMITTED' && approval.status !== 'UNDER_REVIEW') {
      throw new ConflictException('This approval has already been resolved')
    }
    return db.approval.update({
      where: { id },
      data: { status: decision, reviewedBy, reviewedAt: new Date(), reviewNote },
    })
  }

  private async mustFind(id: string, db: Db = this.prisma) {
    const approval = await db.approval.findUnique({ where: { id } })
    if (!approval) throw new NotFoundException('Approval not found')
    return approval
  }
}
