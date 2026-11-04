import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ApprovalsService } from '../common/approvals/approvals.service'
import { CompleteSignUpDto } from './dto/complete-sign-up.dto'

/** The approval an Operator works through to check a new member's ID proof. */
export const ID_PROOF_ACTION = 'member.id_proof.verify'
/** consent_records.version for the sign-up consent text shown in the web app. */
export const SIGN_UP_CONSENT_VERSION = 'sign-up-2026-11'

export type IdProofState = 'NOT_SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'NEEDS_ATTENTION'

export interface SignUpStatus {
  idProof: { state: IdProofState; submittedAt: string | null; note: string | null }
}

/**
 * The last step of sign-up (web /sign-up, step 4): the ID proof goes to the
 * Operator queue as an approval, and the person's consent is recorded. What a
 * member sees of it is plain status: never who reviewed it.
 */
@Injectable()
export class SignUpService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
  ) {}

  async complete(userId: string, dto: CompleteSignUpDto): Promise<SignUpStatus> {
    const file = await this.prisma.uploadedFile.findUnique({ where: { id: dto.idProofFileId } })
    if (!file || file.uploaderId !== userId || file.purpose !== 'DOCUMENT' || file.status !== 'ACTIVE') {
      throw new BadRequestException('Upload your ID proof again: this file was not received.')
    }
    const member = await this.prisma.member.findUnique({ where: { userId }, select: { id: true } })
    if (!member) throw new BadRequestException('Complete registration first.')

    const proof = { fileId: file.id, kind: dto.idProofKind ?? 'OTHER' }
    const open = await this.prisma.approval.findFirst({
      where: { actionCode: ID_PROOF_ACTION, submittedBy: userId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
    })
    await this.prisma.$transaction(async (tx) => {
      for (const consentType of ['PROFILE_STORAGE', 'ID_PROOF_DECLARATION']) {
        await tx.consentRecord.create({ data: { userId, consentType, granted: true, version: SIGN_UP_CONSENT_VERSION } })
      }
      if (open) {
        // A second upload replaces the one waiting for review.
        await tx.approval.update({ where: { id: open.id }, data: { newValue: proof } })
      } else {
        await this.approvals.submit(
          { actionCode: ID_PROOF_ACTION, entityType: 'Member', entityId: member.id, newValue: proof, submittedBy: userId },
          tx,
        )
      }
    })
    return this.status(userId)
  }

  async status(userId: string): Promise<SignUpStatus> {
    const latest = await this.prisma.approval.findFirst({
      where: { actionCode: ID_PROOF_ACTION, submittedBy: userId },
      orderBy: { submittedAt: 'desc' },
      select: { status: true, submittedAt: true, reviewNote: true },
    })
    if (!latest) return { idProof: { state: 'NOT_SUBMITTED', submittedAt: null, note: null } }
    const state: IdProofState =
      latest.status === 'APPROVED' ? 'VERIFIED' : latest.status === 'REJECTED' || latest.status === 'RETURNED' ? 'NEEDS_ATTENTION' : 'UNDER_REVIEW'
    return {
      idProof: {
        state,
        submittedAt: latest.submittedAt.toISOString(),
        // The note tells the member what to fix; it never names the reviewer.
        note: state === 'NEEDS_ATTENTION' ? latest.reviewNote : null,
      },
    }
  }
}
