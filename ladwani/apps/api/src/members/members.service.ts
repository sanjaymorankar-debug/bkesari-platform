import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Approval, Member, Prisma } from '@prisma/client'
import { DEFAULT_FIELD_VISIBILITY } from '@community-platform/shared-types'
import { filterFields, type VisibilityOwner, type VisibilityViewer } from '../common/privacy/visibility'
import { PrismaService } from '../prisma/prisma.service'
import { ApprovalsService } from '../common/approvals/approvals.service'
import { DuplicateDetectionService, DuplicateMatch } from '../common/duplicate-detection/duplicate-detection.service'
import { RelationshipsService } from '../common/relationships/relationships.service'
import { FamilyAuthorizationService } from '../common/family-authorization/family-authorization.service'
import { AddNewMemberDto } from './dto/add-new-member.dto'
import { ChangeMaritalStatusDto } from './dto/change-marital-status.dto'
import { MarkDeceasedDto } from './dto/mark-deceased.dto'
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto'

type Tx = Prisma.TransactionClient

type MemberWithProfileRelations = Member & {
  educationLevel?: { label: string } | null
  occupation?: { label: string } | null
  skills?: { skill: { id: string; label: string } }[]
}

const PROFILE_RELATIONS_INCLUDE = {
  educationLevel: true,
  occupation: true,
  skills: { include: { skill: true } },
} as const

export interface MemberSearchFilters {
  q?: string
  familyQuery?: string
  memberId?: string
  areaId?: string
  city?: string
  state?: string
  nativeVillage?: string
  educationLevelId?: string
  occupationId?: string
  skillId?: string
  maritalStatus?: string
  gender?: string
  minAge?: number
  maxAge?: number
  matrimonyAvailable?: boolean
  page?: number
  pageSize?: number
}

const MAX_PAGE_SIZE = 50

interface FamilyMemberAddPayload {
  mode: 'NEW' | 'EXISTING'
  familyId: string
  relatedToMemberId: string
  relationshipTypeCode: string
  memberId?: string
  memberData?: {
    firstName: string
    middleName?: string
    lastName?: string
    gender?: string
    dateOfBirth?: string
    currentCity?: string
    currentState?: string
    nativeVillage?: string
  }
}

interface MaritalStatusPayload {
  status: string
  effectiveDate?: string
  spouseMode?: 'EXISTING_MEMBER' | 'NEW_MEMBER' | 'NON_COMMUNITY'
  spouseMemberId?: string
  externalSpouseName?: string
  newSpouseData?: FamilyMemberAddPayload['memberData']
}

interface MarkDeceasedPayload {
  deceasedAt: string
  deceasedPlace?: string
}

@Injectable()
export class MembersService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private duplicateDetection: DuplicateDetectionService,
    private relationships: RelationshipsService,
    private familyAuth: FamilyAuthorizationService,
  ) {}

  async addNewMember(familyId: string, kartaUserId: string, dto: AddNewMemberDto): Promise<{ approval: Approval; duplicates: DuplicateMatch[] }> {
    await this.familyAuth.assertIsKarta(kartaUserId, familyId)

    const relatedMember = await this.prisma.familyMember.findUnique({
      where: { familyId_memberId: { familyId, memberId: dto.relatedToMemberId } },
    })
    if (!relatedMember) throw new BadRequestException('relatedToMemberId must be an existing member of this family.')

    const duplicates = await this.duplicateDetection.checkMember({
      firstName: dto.memberData.firstName,
      lastName: dto.memberData.lastName,
      dateOfBirth: dto.memberData.dateOfBirth,
      nativeVillage: dto.memberData.nativeVillage,
    })
    if (duplicates.length > 0 && !dto.acknowledgedDuplicates) {
      throw new ConflictException({
        message: 'Possible duplicate members found. Review and resubmit with acknowledgedDuplicates=true to proceed anyway.',
        duplicates,
      })
    }

    const payload: FamilyMemberAddPayload = {
      mode: 'NEW',
      familyId,
      relatedToMemberId: dto.relatedToMemberId,
      relationshipTypeCode: dto.relationshipTypeCode,
      memberData: { ...dto.memberData, dateOfBirth: dto.memberData.dateOfBirth?.toISOString() },
    }

    const approval = await this.approvals.submit({
      actionCode: 'family.member.add',
      entityType: 'Member',
      newValue: payload,
      submittedBy: kartaUserId,
    })
    return { approval, duplicates }
  }

  async removeMember(familyId: string, memberId: string, kartaUserId: string, reason?: string) {
    await this.familyAuth.assertIsKarta(kartaUserId, familyId)

    const fm = await this.prisma.familyMember.findUnique({ where: { familyId_memberId: { familyId, memberId } } })
    if (!fm || fm.leftAt) throw new NotFoundException('Active membership not found for this member in this family.')
    if (fm.isKarta) throw new ConflictException('Transfer Karta to another member before removing yourself.')

    return this.prisma.familyMember.update({
      where: { id: fm.id },
      data: { leftAt: new Date(), leftReason: reason ?? 'ERROR' },
    })
  }

  async changeMaritalStatus(memberId: string, actorUserId: string, dto: ChangeMaritalStatusDto): Promise<{ approval: Approval }> {
    const member = await this.prisma.member.findUnique({ where: { id: memberId } })
    if (!member || member.deletedAt) throw new NotFoundException('Member not found')

    await this.assertCanActOnMember(member, actorUserId, "Only the member themself or their family's Karta can change marital status.")

    if (dto.status === 'MARRIED') {
      if (dto.spouseMode === 'EXISTING_MEMBER' && !dto.spouseMemberId) throw new BadRequestException('spouseMemberId is required for spouseMode EXISTING_MEMBER.')
      if (dto.spouseMode === 'NEW_MEMBER' && !dto.newSpouseData) throw new BadRequestException('newSpouseData is required for spouseMode NEW_MEMBER.')
      if (dto.spouseMode === 'NON_COMMUNITY' && !dto.externalSpouseName) throw new BadRequestException('externalSpouseName is required for spouseMode NON_COMMUNITY.')
    }

    const payload: MaritalStatusPayload = {
      status: dto.status,
      effectiveDate: dto.effectiveDate?.toISOString(),
      spouseMode: dto.spouseMode,
      spouseMemberId: dto.spouseMemberId,
      externalSpouseName: dto.externalSpouseName,
      newSpouseData: dto.newSpouseData ? { ...dto.newSpouseData, dateOfBirth: dto.newSpouseData.dateOfBirth?.toISOString() } : undefined,
    }

    const approval = await this.approvals.submit({
      actionCode: 'member.marital_status.change',
      entityType: 'Member',
      entityId: memberId,
      newValue: payload,
      submittedBy: actorUserId,
    })
    return { approval }
  }

  async markDeceased(memberId: string, actorUserId: string, dto: MarkDeceasedDto): Promise<{ approval: Approval }> {
    const member = await this.prisma.member.findUnique({ where: { id: memberId } })
    if (!member || member.deletedAt) throw new NotFoundException('Member not found')
    if (member.status === 'DECEASED') throw new ConflictException('Member is already marked deceased.')

    await this.assertCanActOnMember(member, actorUserId, "Only this member's family Karta or an Admin can mark them deceased.", { skipSelfBypass: true })

    const payload: MarkDeceasedPayload = { deceasedAt: dto.deceasedAt.toISOString(), deceasedPlace: dto.deceasedPlace }

    const approval = await this.approvals.submit({
      actionCode: 'member.mark_deceased',
      entityType: 'Member',
      entityId: memberId,
      newValue: payload,
      submittedBy: actorUserId,
    })
    return { approval }
  }

  /**
   * Multi-field directory search (docs/02-feature-map.md §4) — every filter is optional and
   * AND-combined; `q` is the only free-text filter (name), everything else is an exact or
   * range match against a real column/relation so results stay indexable at scale.
   */
  async search(filters: MemberSearchFilters, viewer: VisibilityViewer) {
    const hasAnyFilter = Object.values(filters).some((v) => v !== undefined && v !== '')
    if (!hasAnyFilter) return { data: [], total: 0 }

    const pageSize = Math.min(filters.pageSize ?? 20, MAX_PAGE_SIZE)
    const page = Math.max(filters.page ?? 1, 1)

    const where: Prisma.MemberWhereInput = {
      deletedAt: null,
      id: filters.memberId || undefined,
      gender: filters.gender || undefined,
      maritalStatus: filters.maritalStatus || undefined,
      currentCity: filters.city ? { contains: filters.city, mode: 'insensitive' } : undefined,
      currentState: filters.state ? { contains: filters.state, mode: 'insensitive' } : undefined,
      nativeVillage: filters.nativeVillage ? { contains: filters.nativeVillage, mode: 'insensitive' } : undefined,
      educationLevelId: filters.educationLevelId || undefined,
      occupationId: filters.occupationId || undefined,
      dateOfBirth: this.ageRangeToDobFilter(filters.minAge, filters.maxAge),
      OR: filters.q ? [{ firstName: { contains: filters.q, mode: 'insensitive' } }, { lastName: { contains: filters.q, mode: 'insensitive' } }] : undefined,
      families: filters.familyQuery
        ? { some: { leftAt: null, family: { OR: [{ name: { contains: filters.familyQuery, mode: 'insensitive' } }, { registrationNumber: { contains: filters.familyQuery, mode: 'insensitive' } }] } } }
        : undefined,
      memberAreas: filters.areaId ? { some: { areaId: filters.areaId } } : undefined,
      skills: filters.skillId ? { some: { skillId: filters.skillId } } : undefined,
      matrimonyProfile: filters.matrimonyAvailable ? { isVisible: true } : undefined,
    }

    const [members, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        include: { families: true, ...PROFILE_RELATIONS_INCLUDE },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.member.count({ where }),
    ])

    return { data: members.map((m) => this.toPublicMember(m, viewer, m.families.filter((fm) => !fm.leftAt).map((fm) => fm.familyId))), total }
  }

  private ageRangeToDobFilter(minAge?: number, maxAge?: number) {
    if (minAge == null && maxAge == null) return undefined
    const now = Date.now()
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000
    const gte = maxAge != null ? new Date(now - maxAge * msPerYear) : undefined
    const lte = minAge != null ? new Date(now - minAge * msPerYear) : undefined
    return { gte, lte }
  }

  async getById(memberId: string, viewer: VisibilityViewer) {
    const member = await this.prisma.member.findUnique({ where: { id: memberId }, include: { families: true, ...PROFILE_RELATIONS_INCLUDE } })
    if (!member || member.deletedAt) throw new NotFoundException('Member not found')
    return this.toPublicMember(member, viewer, member.families.filter((fm) => !fm.leftAt).map((fm) => fm.familyId))
  }

  /**
   * Unfiltered — the privacy engine exists to protect a record from OTHER viewers, and this is
   * always the owner looking at their own data (resolved from their userId, never a client-
   * supplied id), so there is nothing to filter. This is also the shape the edit form needs:
   * raw educationLevelId/occupationId/skill ids, not the resolved labels toPublicMember returns.
   */
  async getOwnProfile(userId: string) {
    const member = await this.prisma.member.findUnique({ where: { userId }, include: PROFILE_RELATIONS_INCLUDE })
    if (!member) throw new NotFoundException('Complete registration before editing your profile.')
    return this.toOwnProfileView(member)
  }

  /**
   * Self-service only — resolves the caller's own member record from their userId, so there is
   * no :id param to target someone else's profile through this route at all. An Admin editing
   * someone else's profile (`profile:edit:any`) is a separate, not-yet-built capability.
   */
  async updateOwnProfile(userId: string, dto: UpdateOwnProfileDto) {
    const member = await this.prisma.member.findUnique({ where: { userId } })
    if (!member) throw new NotFoundException('Complete registration before editing your profile.')

    const { skillIds, ...fields } = dto

    return this.prisma.$transaction(async (tx) => {
      await tx.member.update({ where: { id: member.id }, data: fields })

      if (skillIds) {
        await tx.memberSkill.deleteMany({ where: { memberId: member.id } })
        if (skillIds.length > 0) {
          await tx.memberSkill.createMany({ data: skillIds.map((skillId) => ({ memberId: member.id, skillId })), skipDuplicates: true })
        }
      }

      const full = await tx.member.findUniqueOrThrow({ where: { id: member.id }, include: PROFILE_RELATIONS_INCLUDE })
      return this.toOwnProfileView(full)
    })
  }

  private toOwnProfileView(member: MemberWithProfileRelations) {
    return {
      currentCity: member.currentCity,
      currentState: member.currentState,
      nativeVillage: member.nativeVillage,
      nativeDistrict: member.nativeDistrict,
      nativeState: member.nativeState,
      educationLevelId: member.educationLevelId,
      occupationId: member.occupationId,
      employerOrBusiness: member.employerOrBusiness,
      incomeRange: member.incomeRange,
      bio: member.bio,
      skills: member.skills?.map((ms) => ({ id: ms.skill.id, label: ms.skill.label })) ?? [],
    }
  }

  // ── Approval appliers, invoked by ApprovalDispatchService once an Operator decides ──

  async applyFamilyMemberAddApproval(tx: Tx, approval: Approval): Promise<void> {
    if (approval.status !== 'APPROVED') return
    const data = approval.newValue as unknown as FamilyMemberAddPayload

    if (data.mode === 'NEW' && data.memberData) {
      const member = await tx.member.create({
        data: {
          firstName: data.memberData.firstName,
          middleName: data.memberData.middleName,
          lastName: data.memberData.lastName,
          gender: data.memberData.gender ?? 'NOT_STATED',
          dateOfBirth: data.memberData.dateOfBirth ? new Date(data.memberData.dateOfBirth) : null,
          currentCity: data.memberData.currentCity,
          currentState: data.memberData.currentState,
          nativeVillage: data.memberData.nativeVillage,
          createdBy: approval.submittedBy,
        },
      })
      await tx.familyMember.create({ data: { familyId: data.familyId, memberId: member.id, joinedBy: approval.submittedBy } })
      await this.relationships.linkMembers(tx, {
        fromMemberId: member.id,
        toMemberId: data.relatedToMemberId,
        relationshipTypeCode: data.relationshipTypeCode,
        familyId: data.familyId,
        createdBy: approval.submittedBy,
      })
    } else if (data.mode === 'EXISTING' && data.memberId) {
      await tx.familyMember.create({ data: { familyId: data.familyId, memberId: data.memberId, joinedBy: approval.submittedBy } })
      await this.relationships.linkMembers(tx, {
        fromMemberId: data.memberId,
        toMemberId: data.relatedToMemberId,
        relationshipTypeCode: data.relationshipTypeCode,
        familyId: data.familyId,
        createdBy: approval.submittedBy,
      })
    }
  }

  async applyMaritalStatusApproval(tx: Tx, approval: Approval): Promise<void> {
    if (approval.status !== 'APPROVED' || !approval.entityId) return
    const data = approval.newValue as unknown as MaritalStatusPayload
    const memberId = approval.entityId

    const updated = await tx.member.update({ where: { id: memberId }, data: { maritalStatus: data.status } })
    await tx.maritalStatusHistory.create({
      data: { memberId, status: data.status, effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null, changedBy: approval.submittedBy },
    })

    if (data.status !== 'MARRIED') return

    // Relationship types are gender-specific in the current seed (husband=MALE, wife=FEMALE) — a
    // known limitation, not a M1 concern to redesign; default to husband for non-FEMALE genders.
    const spouseRelationshipCode = updated.gender === 'FEMALE' ? 'wife' : 'husband'
    const marriageDate = data.effectiveDate ? new Date(data.effectiveDate) : null

    if (data.spouseMode === 'EXISTING_MEMBER' && data.spouseMemberId) {
      await tx.marriageRecord.create({ data: { memberId1: memberId, memberId2: data.spouseMemberId, marriageDate, createdBy: approval.submittedBy } })
      await this.relationships.linkMembers(tx, {
        fromMemberId: memberId,
        toMemberId: data.spouseMemberId,
        relationshipTypeCode: spouseRelationshipCode,
        createdBy: approval.submittedBy,
      })
    } else if (data.spouseMode === 'NEW_MEMBER' && data.newSpouseData) {
      const spouse = await tx.member.create({
        data: {
          firstName: data.newSpouseData.firstName,
          middleName: data.newSpouseData.middleName,
          lastName: data.newSpouseData.lastName,
          gender: data.newSpouseData.gender ?? (spouseRelationshipCode === 'wife' ? 'MALE' : 'FEMALE'),
          dateOfBirth: data.newSpouseData.dateOfBirth ? new Date(data.newSpouseData.dateOfBirth) : null,
          maritalStatus: 'MARRIED',
          createdBy: approval.submittedBy,
        },
      })
      await tx.marriageRecord.create({ data: { memberId1: memberId, memberId2: spouse.id, marriageDate, createdBy: approval.submittedBy } })
      await this.relationships.linkMembers(tx, {
        fromMemberId: memberId,
        toMemberId: spouse.id,
        relationshipTypeCode: spouseRelationshipCode,
        createdBy: approval.submittedBy,
      })
    } else if (data.spouseMode === 'NON_COMMUNITY' && data.externalSpouseName) {
      await tx.marriageRecord.create({
        data: { memberId1: memberId, externalSpouseName: data.externalSpouseName, marriageDate, createdBy: approval.submittedBy },
      })
    }
  }

  async applyMarkDeceasedApproval(tx: Tx, approval: Approval): Promise<void> {
    if (approval.status !== 'APPROVED' || !approval.entityId) return
    const data = approval.newValue as unknown as MarkDeceasedPayload
    await tx.member.update({
      where: { id: approval.entityId },
      data: { status: 'DECEASED', deceasedAt: new Date(data.deceasedAt), deceasedPlace: data.deceasedPlace },
    })
  }

  private async assertCanActOnMember(
    member: Member,
    actorUserId: string,
    message: string,
    opts: { skipSelfBypass?: boolean } = {},
  ): Promise<void> {
    if (!opts.skipSelfBypass && member.userId === actorUserId) return

    const memberships = await this.prisma.familyMember.findMany({ where: { memberId: member.id, leftAt: null } })
    const kartaChecks = await Promise.all(memberships.map((fm) => this.familyAuth.isKartaOf(actorUserId, fm.familyId)))
    if (kartaChecks.some(Boolean)) return

    const actorRoles = await this.prisma.userRole.findMany({ where: { userId: actorUserId }, include: { role: true } })
    if (actorRoles.some((ur) => ur.role.code === 'ADMIN')) return

    throw new ForbiddenException(message)
  }

  private toPublicMember(member: MemberWithProfileRelations, viewer: VisibilityViewer, familyIds: string[]) {
    const owner: VisibilityOwner = { userId: member.userId, familyIds }
    const sensitive = filterFields(
      {
        dateOfBirth: member.dateOfBirth,
        maritalStatus: member.maritalStatus,
        currentCity: member.currentCity,
        currentState: member.currentState,
        nativeVillage: member.nativeVillage,
        incomeRange: member.incomeRange,
        education: member.educationLevel?.label ?? null,
        occupation: member.occupation?.label ?? null,
        bio: member.bio,
        employerOrBusiness: member.employerOrBusiness,
        skills: member.skills?.map((ms) => ({ id: ms.skill.id, label: ms.skill.label })) ?? [],
      },
      DEFAULT_FIELD_VISIBILITY,
      viewer,
      owner,
    )
    return {
      id: member.id,
      firstName: member.firstName,
      middleName: member.middleName,
      lastName: member.lastName,
      gender: member.gender,
      status: member.status,
      profilePhotoId: member.profilePhotoId,
      ...sensitive,
    }
  }
}
