import { Test } from '@nestjs/testing'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { ApprovalsService } from './approvals.service'
import { PrismaService } from '../../prisma/prisma.service'

describe('ApprovalsService', () => {
  let service: ApprovalsService
  let prisma: {
    approvalRule: { findUnique: jest.Mock }
    approval: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
  }

  beforeEach(async () => {
    prisma = {
      approvalRule: { findUnique: jest.fn() },
      approval: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    }

    const moduleRef = await Test.createTestingModule({
      providers: [ApprovalsService, { provide: PrismaService, useValue: prisma }],
    }).compile()

    service = moduleRef.get(ApprovalsService)
  })

  it('submits as SUBMITTED when the action requires approval', async () => {
    prisma.approvalRule.findUnique.mockResolvedValue({ requiresApproval: true })
    prisma.approval.create.mockResolvedValue({ id: 'a1', status: 'SUBMITTED' })

    await service.submit({ actionCode: 'member.mark_deceased', submittedBy: 'u1' })

    expect(prisma.approval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    )
  })

  it('auto-approves when the action rule says approval is not required', async () => {
    prisma.approvalRule.findUnique.mockResolvedValue({ requiresApproval: false })
    prisma.approval.create.mockResolvedValue({ id: 'a2', status: 'APPROVED' })

    await service.submit({ actionCode: 'member.edit_own', submittedBy: 'u1' })

    expect(prisma.approval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
    )
  })

  it('defaults to requiring approval when no rule is configured for the action', async () => {
    prisma.approvalRule.findUnique.mockResolvedValue(null)
    prisma.approval.create.mockResolvedValue({ id: 'a3', status: 'SUBMITTED' })

    await service.submit({ actionCode: 'unknown.action', submittedBy: 'u1' })

    expect(prisma.approval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    )
  })

  it('rejects deciding an approval that does not exist', async () => {
    prisma.approval.findUnique.mockResolvedValue(null)
    await expect(service.decide('missing', 'APPROVED', 'admin-1')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects deciding an approval that was already resolved', async () => {
    prisma.approval.findUnique.mockResolvedValue({ id: 'a1', status: 'APPROVED' })
    await expect(service.decide('a1', 'REJECTED', 'admin-1')).rejects.toBeInstanceOf(ConflictException)
  })

  it('allows deciding a SUBMITTED or UNDER_REVIEW approval', async () => {
    prisma.approval.findUnique.mockResolvedValue({ id: 'a1', status: 'UNDER_REVIEW' })
    prisma.approval.update.mockResolvedValue({ id: 'a1', status: 'APPROVED' })

    const result = await service.decide('a1', 'APPROVED', 'admin-1', 'looks fine')

    expect(prisma.approval.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'admin-1', reviewNote: 'looks fine' }),
    })
    expect(result.status).toBe('APPROVED')
  })
})
