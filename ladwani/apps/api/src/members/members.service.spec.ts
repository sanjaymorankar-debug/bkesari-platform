import { Test } from '@nestjs/testing'
import { ConflictException, ForbiddenException } from '@nestjs/common'
import { MembersService } from './members.service'
import { PrismaService } from '../prisma/prisma.service'
import { ApprovalsService } from '../common/approvals/approvals.service'
import { DuplicateDetectionService } from '../common/duplicate-detection/duplicate-detection.service'
import { RelationshipsService } from '../common/relationships/relationships.service'
import { FamilyAuthorizationService } from '../common/family-authorization/family-authorization.service'

describe('MembersService', () => {
  let service: MembersService
  let prisma: {
    member: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock; create: jest.Mock; findMany: jest.Mock; count: jest.Mock; findUniqueOrThrow: jest.Mock }
    familyMember: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
    userRole: { findMany: jest.Mock }
    maritalStatusHistory: { create: jest.Mock }
    marriageRecord: { create: jest.Mock }
    memberSkill: { deleteMany: jest.Mock; createMany: jest.Mock }
    $transaction: jest.Mock
  }
  let approvals: { submit: jest.Mock }
  let familyAuth: { isKartaOf: jest.Mock; assertIsKarta: jest.Mock }

  beforeEach(async () => {
    prisma = {
      member: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn(), create: jest.fn(), findMany: jest.fn(), count: jest.fn(), findUniqueOrThrow: jest.fn() },
      familyMember: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      userRole: { findMany: jest.fn() },
      maritalStatusHistory: { create: jest.fn() },
      marriageRecord: { create: jest.fn() },
      memberSkill: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation((fn) => fn(prisma))
    approvals = { submit: jest.fn() }
    familyAuth = { isKartaOf: jest.fn(), assertIsKarta: jest.fn() }

    const moduleRef = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalsService, useValue: approvals },
        { provide: DuplicateDetectionService, useValue: { checkMember: jest.fn().mockResolvedValue([]) } },
        { provide: RelationshipsService, useValue: { linkMembers: jest.fn() } },
        { provide: FamilyAuthorizationService, useValue: familyAuth },
      ],
    }).compile()

    service = moduleRef.get(MembersService)
  })

  describe('Karta-vs-member permission boundaries', () => {
    it('lets the member themself submit their own marital status change', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'u1', deletedAt: null })
      approvals.submit.mockResolvedValue({ id: 'a1', status: 'SUBMITTED' })

      await service.changeMaritalStatus('m1', 'u1', { status: 'MARRIED', spouseMode: 'NON_COMMUNITY', externalSpouseName: 'Anita' } as never)

      expect(approvals.submit).toHaveBeenCalled()
      expect(familyAuth.isKartaOf).not.toHaveBeenCalled()
    })

    it("lets the member's family Karta submit a marital status change on their behalf", async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'other-user', deletedAt: null })
      prisma.familyMember.findMany.mockResolvedValue([{ familyId: 'fam-1' }])
      familyAuth.isKartaOf.mockResolvedValue(true)
      approvals.submit.mockResolvedValue({ id: 'a1', status: 'SUBMITTED' })

      await service.changeMaritalStatus('m1', 'karta-user', { status: 'UNMARRIED' } as never)

      expect(familyAuth.isKartaOf).toHaveBeenCalledWith('karta-user', 'fam-1')
      expect(approvals.submit).toHaveBeenCalled()
    })

    it('rejects a plain member (not self, not Karta, not Admin) trying to change someone else\'s marital status', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'other-user', deletedAt: null })
      prisma.familyMember.findMany.mockResolvedValue([{ familyId: 'fam-1' }])
      familyAuth.isKartaOf.mockResolvedValue(false)
      prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'MEMBER' } }])

      await expect(service.changeMaritalStatus('m1', 'stranger-user', { status: 'UNMARRIED' } as never)).rejects.toBeInstanceOf(
        ForbiddenException,
      )
      expect(approvals.submit).not.toHaveBeenCalled()
    })

    it('lets an Admin mark a member deceased even without Karta authority over that family', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'other-user', status: 'ACTIVE', deletedAt: null })
      prisma.familyMember.findMany.mockResolvedValue([{ familyId: 'fam-1' }])
      familyAuth.isKartaOf.mockResolvedValue(false)
      prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'ADMIN' } }])
      approvals.submit.mockResolvedValue({ id: 'a1', status: 'SUBMITTED' })

      await service.markDeceased('m1', 'admin-user', { deceasedAt: new Date('2026-01-01') } as never)

      expect(approvals.submit).toHaveBeenCalled()
    })

    it('rejects a non-Karta, non-Admin trying to mark a member deceased', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'other-user', status: 'ACTIVE', deletedAt: null })
      prisma.familyMember.findMany.mockResolvedValue([{ familyId: 'fam-1' }])
      familyAuth.isKartaOf.mockResolvedValue(false)
      prisma.userRole.findMany.mockResolvedValue([{ role: { code: 'MEMBER' } }])

      await expect(service.markDeceased('m1', 'stranger-user', { deceasedAt: new Date() } as never)).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('only the Karta can remove a member from the family (self-service, no queue)', async () => {
      familyAuth.assertIsKarta.mockRejectedValue(new ForbiddenException())

      await expect(service.removeMember('fam-1', 'm2', 'not-karta-user')).rejects.toBeInstanceOf(ForbiddenException)
      expect(prisma.familyMember.update).not.toHaveBeenCalled()
    })
  })

  describe('deceased members are never hard-deleted', () => {
    it('marks a member deceased via a status field update, never a delete call', async () => {
      const tx = { member: { update: jest.fn().mockResolvedValue({}), delete: jest.fn() } }
      const approval = {
        status: 'APPROVED',
        entityId: 'm1',
        newValue: { deceasedAt: '2026-01-01T00:00:00.000Z', deceasedPlace: 'Pune' },
      } as never

      await service.applyMarkDeceasedApproval(tx as never, approval)

      expect(tx.member.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { status: 'DECEASED', deceasedAt: new Date('2026-01-01T00:00:00.000Z'), deceasedPlace: 'Pune' },
      })
      expect(tx.member.delete).not.toHaveBeenCalled()
    })

    it('does not apply anything if the approval was rejected', async () => {
      const tx = { member: { update: jest.fn(), delete: jest.fn() } }
      const approval = { status: 'REJECTED', entityId: 'm1', newValue: { deceasedAt: '2026-01-01' } } as never

      await service.applyMarkDeceasedApproval(tx as never, approval)

      expect(tx.member.update).not.toHaveBeenCalled()
      expect(tx.member.delete).not.toHaveBeenCalled()
    })

    it('removing a member from a family only soft-closes the membership, never deletes the member', async () => {
      familyAuth.assertIsKarta.mockResolvedValue(undefined)
      prisma.familyMember.findUnique.mockResolvedValue({ id: 'fm1', isKarta: false, leftAt: null })
      prisma.familyMember.update.mockResolvedValue({ id: 'fm1', leftAt: new Date() })

      await service.removeMember('fam-1', 'm2', 'karta-user', 'MARRIED_OUT')

      expect(prisma.familyMember.update).toHaveBeenCalledWith({
        where: { id: 'fm1' },
        data: { leftAt: expect.any(Date), leftReason: 'MARRIED_OUT' },
      })
      expect(prisma.member.delete).not.toHaveBeenCalled()
    })

    it('refuses to let the Karta remove themself without transferring Karta first', async () => {
      familyAuth.assertIsKarta.mockResolvedValue(undefined)
      prisma.familyMember.findUnique.mockResolvedValue({ id: 'fm1', isKarta: true, leftAt: null })

      await expect(service.removeMember('fam-1', 'karta-member-id', 'karta-user')).rejects.toBeInstanceOf(ConflictException)
    })
  })

  describe('multi-field directory search', () => {
    const viewer = { isAuthenticated: true, userId: 'viewer-1' }
    function member(overrides: Record<string, unknown> = {}) {
      return {
        id: 'm1',
        userId: null,
        firstName: 'Ravi',
        lastName: 'Deshmukh',
        gender: 'MALE',
        status: 'ACTIVE',
        profilePhotoId: null,
        dateOfBirth: null,
        maritalStatus: 'UNMARRIED',
        currentCity: 'Pune',
        currentState: 'MH',
        incomeRange: null,
        bio: null,
        employerOrBusiness: null,
        educationLevel: null,
        occupation: null,
        skills: [],
        families: [],
        ...overrides,
      }
    }

    it('returns empty without hitting the database when no filter is given', async () => {
      const result = await service.search({}, viewer)
      expect(result).toEqual({ data: [], total: 0 })
      expect(prisma.member.findMany).not.toHaveBeenCalled()
    })

    it('combines multiple filters into one AND-ed where clause', async () => {
      prisma.member.findMany.mockResolvedValue([])
      prisma.member.count.mockResolvedValue(0)

      await service.search({ city: 'Pune', gender: 'MALE', maritalStatus: 'UNMARRIED', educationLevelId: 'el-1' }, viewer)

      expect(prisma.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
            gender: 'MALE',
            maritalStatus: 'UNMARRIED',
            currentCity: { contains: 'Pune', mode: 'insensitive' },
            educationLevelId: 'el-1',
          }),
        }),
      )
    })

    it('paginates results and reports the true total, not just the page size', async () => {
      prisma.member.findMany.mockResolvedValue([member()])
      prisma.member.count.mockResolvedValue(57)

      const result = await service.search({ city: 'Pune', page: 2, pageSize: 10 }, viewer)

      expect(prisma.member.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }))
      expect(result.total).toBe(57)
      expect(result.data).toHaveLength(1)
    })

    it('caps page size even if a huge value is requested', async () => {
      prisma.member.findMany.mockResolvedValue([])
      prisma.member.count.mockResolvedValue(0)

      await service.search({ city: 'Pune', pageSize: 10_000 }, viewer)

      expect(prisma.member.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
    })

    it('never leaks education/occupation/income to a viewer outside the registered community', async () => {
      prisma.member.findMany.mockResolvedValue([
        member({ incomeRange: 'L5_10L', educationLevel: { label: 'Graduate' }, occupation: { label: 'Engineer' } }),
      ])
      prisma.member.count.mockResolvedValue(1)

      const anonymousViewer = { isAuthenticated: false }
      const result = await service.search({ city: 'Pune' }, anonymousViewer)

      expect(result.data[0]).not.toHaveProperty('incomeRange')
      expect(result.data[0]).not.toHaveProperty('education')
      expect(result.data[0]).not.toHaveProperty('occupation')
    })

    it('surfaces education/occupation/skills to an authenticated registered-community viewer', async () => {
      prisma.member.findMany.mockResolvedValue([
        member({ educationLevel: { label: 'Graduate' }, occupation: { label: 'Engineer' }, skills: [{ skill: { id: 'sk-1', label: 'Cooking' } }] }),
      ])
      prisma.member.count.mockResolvedValue(1)

      const result = await service.search({ city: 'Pune' }, viewer)

      expect(result.data[0]).toMatchObject({ education: 'Graduate', occupation: 'Engineer', skills: [{ id: 'sk-1', label: 'Cooking' }] })
    })

    it('filters to members with a visible matrimony profile when matrimonyAvailable is set', async () => {
      prisma.member.findMany.mockResolvedValue([])
      prisma.member.count.mockResolvedValue(0)

      await service.search({ city: 'Pune', matrimonyAvailable: true }, viewer)

      expect(prisma.member.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ matrimonyProfile: { isVisible: true } }) }))
    })
  })

  describe('self-service own-profile editing', () => {
    function findUniqueOrThrowResult(overrides: Record<string, unknown> = {}) {
      return {
        id: 'm1',
        userId: 'user-1',
        firstName: 'Ravi',
        lastName: null,
        gender: 'MALE',
        status: 'ACTIVE',
        profilePhotoId: null,
        dateOfBirth: null,
        maritalStatus: 'UNMARRIED',
        currentCity: 'Pune',
        currentState: null,
        incomeRange: null,
        bio: null,
        employerOrBusiness: null,
        educationLevel: null,
        occupation: null,
        skills: [],
        families: [],
        ...overrides,
      }
    }

    it("resolves the caller's own member from their userId, never from a client-supplied id", async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'user-1' })
      prisma.member.findUniqueOrThrow.mockResolvedValue(findUniqueOrThrowResult())

      await service.updateOwnProfile('user-1', { bio: 'Loves trekking' })

      expect(prisma.member.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } })
      expect(prisma.member.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { bio: 'Loves trekking' } })
    })

    it('replaces the skill set rather than merging when skillIds is provided', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'user-1' })
      prisma.member.findUniqueOrThrow.mockResolvedValue(findUniqueOrThrowResult())

      await service.updateOwnProfile('user-1', { skillIds: ['sk-1', 'sk-2'] })

      expect(prisma.memberSkill.deleteMany).toHaveBeenCalledWith({ where: { memberId: 'm1' } })
      expect(prisma.memberSkill.createMany).toHaveBeenCalledWith({
        data: [{ memberId: 'm1', skillId: 'sk-1' }, { memberId: 'm1', skillId: 'sk-2' }],
        skipDuplicates: true,
      })
    })

    it('clears all skills when skillIds is an empty array, without a pointless createMany call', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'user-1' })
      prisma.member.findUniqueOrThrow.mockResolvedValue(findUniqueOrThrowResult())

      await service.updateOwnProfile('user-1', { skillIds: [] })

      expect(prisma.memberSkill.deleteMany).toHaveBeenCalledWith({ where: { memberId: 'm1' } })
      expect(prisma.memberSkill.createMany).not.toHaveBeenCalled()
    })

    it('leaves skills untouched when skillIds is omitted entirely', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', userId: 'user-1' })
      prisma.member.findUniqueOrThrow.mockResolvedValue(findUniqueOrThrowResult())

      await service.updateOwnProfile('user-1', { bio: 'Just a bio update' })

      expect(prisma.memberSkill.deleteMany).not.toHaveBeenCalled()
    })

    describe('getOwnProfile — unfiltered, since it is always the owner viewing their own record', () => {
      it('exposes raw educationLevelId/occupationId (not just labels) so the edit form can pre-select them', async () => {
        prisma.member.findUnique.mockResolvedValue(
          findUniqueOrThrowResult({ educationLevelId: 'el-1', occupationId: 'occ-1', skills: [{ skill: { id: 'sk-1', label: 'Cooking' } }] }),
        )

        const result = await service.getOwnProfile('user-1')

        expect(result).toMatchObject({ educationLevelId: 'el-1', occupationId: 'occ-1', skills: [{ id: 'sk-1', label: 'Cooking' }] })
      })

      it('throws when the caller has no member record yet', async () => {
        prisma.member.findUnique.mockResolvedValue(null)
        await expect(service.getOwnProfile('user-without-member')).rejects.toThrow()
      })
    })
  })
})
