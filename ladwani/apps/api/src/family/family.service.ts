import { randomInt } from 'crypto'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Approval, Prisma } from '@prisma/client'
import { filterFields, type VisibilityOwner, type VisibilityViewer } from '../common/privacy/visibility'
import { DEFAULT_FIELD_VISIBILITY } from '@community-platform/shared-types'
import { PrismaService } from '../prisma/prisma.service'
import { ApprovalsService } from '../common/approvals/approvals.service'
import { DuplicateDetectionService, DuplicateMatch } from '../common/duplicate-detection/duplicate-detection.service'
import { RelationshipsService } from '../common/relationships/relationships.service'
import { FamilyAuthorizationService } from '../common/family-authorization/family-authorization.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CreateFamilyDto } from './dto/create-family.dto'
import { CreateJoinRequestDto } from './dto/create-join-request.dto'

type Tx = Prisma.TransactionClient

@Injectable()
export class FamilyService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private duplicateDetection: DuplicateDetectionService,
    private relationships: RelationshipsService,
    private familyAuth: FamilyAuthorizationService,
    private notifications: NotificationsService,
  ) {}

  async createFamily(userId: string, dto: CreateFamilyDto): Promise<{ family: unknown; duplicates: DuplicateMatch[] }> {
    const duplicates = await this.duplicateDetection.checkFamily({
      name: dto.name,
      nativeVillage: dto.nativeVillage,
      nativeDistrict: dto.nativeDistrict,
    })
    if (duplicates.length > 0 && !dto.acknowledgedDuplicates) {
      throw new ConflictException({
        message: 'Possible duplicate families found. Review and resubmit with acknowledgedDuplicates=true to proceed anyway.',
        duplicates,
      })
    }

    const community = await this.prisma.community.findFirst()
    if (!community) throw new NotFoundException('No community is configured for this platform yet.')

    const family = await this.prisma.$transaction(async (tx) => {
      const member = await tx.member.findUnique({ where: { userId } })
      if (!member) throw new NotFoundException('Complete registration before creating a family.')

      const family = await tx.family.create({
        data: {
          communityId: community.id,
          registrationNumber: await this.generateRegistrationNumber(tx),
          name: dto.name,
          surname: dto.surname,
          kuladevata: dto.kuladevata,
          gotra: dto.gotra,
          nativeVillage: dto.nativeVillage,
          nativeDistrict: dto.nativeDistrict,
          nativeState: dto.nativeState,
          status: 'PENDING',
          verificationStatus: 'UNVERIFIED',
          kartaMemberId: member.id,
          createdBy: userId,
        },
      })
      await tx.familyMember.create({ data: { familyId: family.id, memberId: member.id, isKarta: true, joinedBy: userId } })

      const approval = await this.approvals.submit(
        { actionCode: 'family.create', entityType: 'Family', entityId: family.id, newValue: { duplicates }, submittedBy: userId },
        tx,
      )
      if (approval.status === 'APPROVED') await this.applyFamilyCreateApproval(tx, approval)

      return family
    })

    return { family, duplicates }
  }

  async search(query: string) {
    if (!query || query.trim().length < 2) return []
    return this.prisma.family.findMany({
      where: {
        deletedAt: null,
        OR: [{ name: { contains: query, mode: 'insensitive' } }, { registrationNumber: { contains: query, mode: 'insensitive' } }],
      },
      select: { id: true, name: true, registrationNumber: true, nativeVillage: true, nativeDistrict: true, verificationStatus: true, status: true },
      take: 20,
    })
  }

  async getMine(userId: string) {
    const memberships = await this.prisma.familyMember.findMany({
      where: { member: { userId }, leftAt: null },
      include: { family: true },
    })
    return memberships.map((fm) => ({
      familyId: fm.family.id,
      familyName: fm.family.name,
      registrationNumber: fm.family.registrationNumber,
      status: fm.family.status,
      verificationStatus: fm.family.verificationStatus,
      isKarta: fm.isKarta,
    }))
  }

  async getById(id: string, viewer: VisibilityViewer) {
    const family = await this.prisma.family.findUnique({
      where: { id },
      include: { members: { include: { member: true } } },
    })
    if (!family || family.deletedAt) throw new NotFoundException('Family not found')

    const members = family.members
      .filter((fm) => !fm.leftAt)
      .map((fm) => ({
        familyMemberId: fm.id,
        isKarta: fm.isKarta,
        ...this.toPublicMember(fm.member, viewer, family.id),
      }))

    return { ...family, members }
  }

  async getTree(id: string, viewer: VisibilityViewer) {
    const family = await this.prisma.family.findUnique({ where: { id } })
    if (!family || family.deletedAt) throw new NotFoundException('Family not found')

    const familyMembers = await this.prisma.familyMember.findMany({ where: { familyId: id }, include: { member: true } })
    const memberIds = familyMembers.map((fm) => fm.memberId)

    const relationships = await this.prisma.memberRelationship.findMany({
      where: { isActive: true, fromMemberId: { in: memberIds }, toMemberId: { in: memberIds } },
      include: { relationshipType: true },
    })

    const nodes = familyMembers.map((fm) => ({
      isKarta: fm.isKarta,
      left: !!fm.leftAt,
      ...this.toPublicMember(fm.member, viewer, id),
    }))

    const edges = relationships.map((r) => ({
      fromMemberId: r.fromMemberId,
      toMemberId: r.toMemberId,
      relationshipCode: r.relationshipType.code,
      relationshipLabel: r.relationshipType.label,
    }))

    return { familyId: id, familyName: family.name, nodes, edges }
  }

  async listJoinRequests(familyId: string) {
    return this.prisma.familyJoinRequest.findMany({
      where: { familyId, status: 'PENDING' },
      include: { member: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async createJoinRequest(familyId: string, memberId: string, requestedBy: string, dto: CreateJoinRequestDto) {
    const family = await this.prisma.family.findUnique({ where: { id: familyId } })
    if (!family || family.deletedAt) throw new NotFoundException('Family not found')

    const relatedMember = await this.prisma.familyMember.findUnique({
      where: { familyId_memberId: { familyId, memberId: dto.relatedToMemberId } },
    })
    if (!relatedMember) throw new BadRequestException('relatedToMemberId must be an existing member of this family.')

    const existing = await this.prisma.familyJoinRequest.findUnique({
      where: { familyId_memberId_status: { familyId, memberId, status: 'PENDING' } },
    })
    if (existing) throw new ConflictException('A join request for this member is already pending.')

    const member = await this.prisma.member.findUnique({ where: { id: memberId } })
    const isSelfInitiated = member?.userId === requestedBy

    const request = await this.prisma.familyJoinRequest.create({
      data: {
        familyId,
        memberId,
        relatedToMemberId: dto.relatedToMemberId,
        relationshipTypeCode: dto.relationshipTypeCode,
        requestedBy,
        status: 'PENDING',
      },
    })

    if (isSelfInitiated) {
      const karta = family.kartaMemberId ? await this.prisma.member.findUnique({ where: { id: family.kartaMemberId } }) : null
      if (karta?.userId) {
        await this.notifications.notify({
          recipientId: karta.userId,
          senderId: requestedBy,
          type: 'family.join_request.received',
          title: 'New family join request',
          body: `${member?.firstName ?? 'A member'} asked to join ${family.name}.`,
          data: { requestId: request.id, familyId },
        })
      }
    } else if (member?.userId) {
      await this.notifications.notify({
        recipientId: member.userId,
        senderId: requestedBy,
        type: 'family.join_request.received',
        title: 'You were invited to a family',
        body: `You were invited to join ${family.name}.`,
        data: { requestId: request.id, familyId },
      })
    }

    return request
  }

  async respondToJoinRequest(requestId: string, actorUserId: string, decision: 'APPROVED' | 'DECLINED') {
    const request = await this.prisma.familyJoinRequest.findUnique({
      where: { id: requestId },
      include: { member: true, family: true },
    })
    if (!request) throw new NotFoundException('Join request not found')
    if (request.status !== 'PENDING') throw new ConflictException('This join request has already been resolved.')

    const isSelfInitiated = request.requestedBy === request.member.userId

    if (isSelfInitiated) {
      const isKarta = await this.familyAuth.isKartaOf(actorUserId, request.familyId)
      if (!isKarta) throw new ForbiddenException("Only this family's Karta can respond to a self-join request.")
    } else {
      if (request.member.userId !== actorUserId) {
        throw new ForbiddenException('Only the invited member can respond to this invitation.')
      }
    }

    if (decision === 'DECLINED') {
      const updated = await this.prisma.familyJoinRequest.update({
        where: { id: requestId },
        data: { status: 'DECLINED', respondedAt: new Date() },
      })
      await this.notifications.notify({
        recipientId: request.requestedBy,
        senderId: actorUserId,
        type: 'family.join_request.declined',
        title: 'Your family request was declined',
        body: `Your request regarding ${request.family.name} was declined.`,
        data: { requestId },
      })
      return updated
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.familyJoinRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', respondedAt: new Date() },
      })

      if (isSelfInitiated) {
        if (!request.relatedToMemberId) throw new BadRequestException('Join request is missing the related member.')
        // Karta already vouched for this person — no further Operator gate (J1 step 3a).
        await tx.familyMember.create({ data: { familyId: request.familyId, memberId: request.memberId, joinedBy: actorUserId } })
        await this.relationships.linkMembers(tx, {
          fromMemberId: request.memberId,
          toMemberId: request.relatedToMemberId,
          relationshipTypeCode: request.relationshipTypeCode,
          familyId: request.familyId,
          createdBy: actorUserId,
        })
        await this.notifications.notify(
          {
            recipientId: request.requestedBy,
            senderId: actorUserId,
            type: 'family.join_request.approved',
            title: 'You joined a family',
            body: `You are now a member of ${request.family.name}.`,
            data: { requestId, familyId: request.familyId },
          },
          tx,
        )
      } else {
        // The invited member consented — now it still needs Operator sign-off (J2 step 3b + approval_rules table).
        await this.approvals.submit(
          {
            actionCode: 'family.member.add',
            entityType: 'Member',
            entityId: request.memberId,
            newValue: {
              mode: 'EXISTING',
              familyId: request.familyId,
              memberId: request.memberId,
              relatedToMemberId: request.relatedToMemberId,
              relationshipTypeCode: request.relationshipTypeCode,
            },
            submittedBy: actorUserId,
          },
          tx,
        )
      }

      return updated
    })
  }

  async applyFamilyCreateApproval(tx: Tx, approval: Approval): Promise<void> {
    if (!approval.entityId) return
    if (approval.status === 'APPROVED') {
      const family = await tx.family.update({ where: { id: approval.entityId }, data: { status: 'ACTIVE', verificationStatus: 'VERIFIED' } })

      const kartaRole = await tx.role.findUnique({ where: { code: 'KARTA' } })
      if (kartaRole) {
        const alreadyGranted = await tx.userRole.findFirst({
          where: { userId: approval.submittedBy, roleId: kartaRole.id, familyId: family.id },
        })
        if (!alreadyGranted) {
          await tx.userRole.create({ data: { userId: approval.submittedBy, roleId: kartaRole.id, familyId: family.id } })
        }
      }
    } else if (approval.status === 'REJECTED') {
      await tx.family.update({ where: { id: approval.entityId }, data: { status: 'INACTIVE', verificationStatus: 'REJECTED' } })
    }
  }

  private toPublicMember(
    member: { id: string; firstName: string; middleName: string | null; lastName: string | null; gender: string; status: string; maritalStatus: string; dateOfBirth: Date | null; currentCity: string | null; currentState: string | null; profilePhotoId: string | null; userId: string | null },
    viewer: VisibilityViewer,
    familyId: string,
  ) {
    const owner: VisibilityOwner = { userId: member.userId, familyIds: [familyId] }
    const sensitive = filterFields(
      { dateOfBirth: member.dateOfBirth, maritalStatus: member.maritalStatus, currentCity: member.currentCity, currentState: member.currentState },
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

  private async generateRegistrationNumber(tx: Tx): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `FAM-${new Date().getFullYear()}-${randomInt(100000, 999999)}`
      const existing = await tx.family.findUnique({ where: { registrationNumber: candidate } })
      if (!existing) return candidate
    }
    throw new ConflictException('Could not allocate a registration number, please retry.')
  }
}
