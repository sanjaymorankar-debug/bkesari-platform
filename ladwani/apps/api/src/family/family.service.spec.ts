import { Test } from '@nestjs/testing'
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { FamilyService } from './family.service'
import { PrismaService } from '../prisma/prisma.service'
import { ApprovalsService } from '../common/approvals/approvals.service'
import { DuplicateDetectionService } from '../common/duplicate-detection/duplicate-detection.service'
import { RelationshipsService } from '../common/relationships/relationships.service'
import { FamilyAuthorizationService } from '../common/family-authorization/family-authorization.service'
import { NotificationsService } from '../notifications/notifications.service'

describe('FamilyService', () => {
  let service: FamilyService
  let prisma: {
    community: { findFirst: jest.Mock }
    family: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock }
    familyMember: { create: jest.Mock; findUnique: jest.Mock }
    familyJoinRequest: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock }
    member: { findUnique: jest.Mock }
    $transaction: jest.Mock
  }
  let duplicateDetection: { checkFamily: jest.Mock }
  let approvals: { submit: jest.Mock }
  let familyAuth: { isKartaOf: jest.Mock; assertIsKarta: jest.Mock }
  let relationships: { linkMembers: jest.Mock }
  let notifications: { notify: jest.Mock }

  beforeEach(async () => {
    prisma = {
      community: { findFirst: jest.fn() },
      family: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      familyMember: { create: jest.fn(), findUnique: jest.fn() },
      familyJoinRequest: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      member: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    }
    duplicateDetection = { checkFamily: jest.fn().mockResolvedValue([]) }
    approvals = { submit: jest.fn() }
    familyAuth = { isKartaOf: jest.fn(), assertIsKarta: jest.fn() }
    relationships = { linkMembers: jest.fn() }
    notifications = { notify: jest.fn() }

    const moduleRef = await Test.createTestingModule({
      providers: [
        FamilyService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalsService, useValue: approvals },
        { provide: DuplicateDetectionService, useValue: duplicateDetection },
        { provide: RelationshipsService, useValue: relationships },
        { provide: FamilyAuthorizationService, useValue: familyAuth },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile()

    service = moduleRef.get(FamilyService)
  })

  describe('duplicate-check triggers correctly on family creation', () => {
    it('blocks creation when duplicates are found and not acknowledged', async () => {
      duplicateDetection.checkFamily.mockResolvedValue([{ id: 'fam-existing', reason: 'Same family name' }])
      prisma.community.findFirst.mockResolvedValue({ id: 'community-1' })

      await expect(service.createFamily('user-1', { name: 'Deshmukh Family' } as never)).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('proceeds when duplicates are found but acknowledged', async () => {
      duplicateDetection.checkFamily.mockResolvedValue([{ id: 'fam-existing', reason: 'Same family name' }])
      prisma.community.findFirst.mockResolvedValue({ id: 'community-1' })
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          member: { findUnique: jest.fn().mockResolvedValue({ id: 'member-1' }) },
          family: { create: jest.fn().mockResolvedValue({ id: 'fam-new' }), findUnique: jest.fn().mockResolvedValue(null) },
          familyMember: { create: jest.fn() },
        }),
      )
      approvals.submit.mockResolvedValue({ id: 'approval-1', status: 'SUBMITTED' })

      const result = await service.createFamily('user-1', { name: 'Deshmukh Family', acknowledgedDuplicates: true } as never)

      expect(result.duplicates).toHaveLength(1)
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('proceeds directly when no duplicates are found', async () => {
      duplicateDetection.checkFamily.mockResolvedValue([])
      prisma.community.findFirst.mockResolvedValue({ id: 'community-1' })
      prisma.$transaction.mockImplementation(async (fn) =>
        fn({
          member: { findUnique: jest.fn().mockResolvedValue({ id: 'member-1' }) },
          family: { create: jest.fn().mockResolvedValue({ id: 'fam-new' }), findUnique: jest.fn().mockResolvedValue(null) },
          familyMember: { create: jest.fn() },
        }),
      )
      approvals.submit.mockResolvedValue({ id: 'approval-1', status: 'SUBMITTED' })

      const result = await service.createFamily('user-1', { name: 'Unique Family' } as never)

      expect(result.duplicates).toHaveLength(0)
    })
  })

  describe('join-request authorization (Karta vs. self vs. invited member)', () => {
    it("requires the family's Karta to respond to a self-initiated join request", async () => {
      prisma.familyJoinRequest.findUnique.mockResolvedValue({
        id: 'req-1',
        status: 'PENDING',
        familyId: 'fam-1',
        memberId: 'mem-1',
        requestedBy: 'user-requester',
        relatedToMemberId: 'mem-existing',
        relationshipTypeCode: 'son',
        member: { userId: 'user-requester' },
        family: {},
      })
      familyAuth.isKartaOf.mockResolvedValue(false)

      await expect(service.respondToJoinRequest('req-1', 'not-the-karta', 'APPROVED')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('requires the invited member themself to respond to a Karta-initiated invitation', async () => {
      prisma.familyJoinRequest.findUnique.mockResolvedValue({
        id: 'req-2',
        status: 'PENDING',
        familyId: 'fam-1',
        memberId: 'mem-1',
        requestedBy: 'karta-user',
        relatedToMemberId: 'mem-existing',
        relationshipTypeCode: 'son',
        member: { userId: 'the-invited-member-user' },
        family: {},
      })

      await expect(service.respondToJoinRequest('req-2', 'some-other-user', 'APPROVED')).rejects.toBeInstanceOf(ForbiddenException)
      expect(familyAuth.isKartaOf).not.toHaveBeenCalled()
    })

    it('rejects responding to an already-resolved join request', async () => {
      prisma.familyJoinRequest.findUnique.mockResolvedValue({ id: 'req-3', status: 'APPROVED', member: {}, family: {} })

      await expect(service.respondToJoinRequest('req-3', 'anyone', 'APPROVED')).rejects.toBeInstanceOf(ConflictException)
    })

    it('404s when the join request does not exist', async () => {
      prisma.familyJoinRequest.findUnique.mockResolvedValue(null)

      await expect(service.respondToJoinRequest('missing', 'anyone', 'APPROVED')).rejects.toBeInstanceOf(NotFoundException)
    })
  })
})
