import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { UploadsService } from '../uploads/uploads.service'
import { canViewMatrimonyProfile } from './matrimony-visibility'
import { UpsertMatrimonyProfileDto } from './dto/upsert-profile.dto'
import { UpsertMatrimonyPreferencesDto } from './dto/upsert-preferences.dto'
import { SendInterestDto } from './dto/send-interest.dto'

export interface MatrimonySearchFilters {
  minAge?: number
  maxAge?: number
  gender?: string
  city?: string
  nativeVillage?: string
  educationLevelId?: string
  occupationId?: string
  incomeRange?: string
  maritalStatus?: string
  skillId?: string
  subgroup?: string
  page?: number
  pageSize?: number
}

const MAX_PAGE_SIZE = 50

@Injectable()
export class MatrimonyService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private uploads: UploadsService,
  ) {}

  async upsertProfile(userId: string, dto: UpsertMatrimonyProfileDto) {
    const member = await this.mustGetMember(userId)

    if (dto.isVisible) {
      const hasConsent = await this.prisma.consentRecord.findFirst({
        where: { userId, consentType: 'MATRIMONIAL_VISIBILITY', granted: true, revokedAt: null },
      })
      if (!hasConsent) {
        if (!dto.consentGranted) {
          throw new BadRequestException('Grant matrimonial visibility consent (consentGranted: true) before making your profile visible.')
        }
        await this.prisma.consentRecord.create({
          data: { userId, consentType: 'MATRIMONIAL_VISIBILITY', granted: true, version: '1' },
        })
      }
    }

    const data = {
      about: dto.about,
      heightCm: dto.heightCm,
      languages: dto.languages as never,
      allowContactRequests: dto.allowContactRequests ?? true,
      isVisible: dto.isVisible ?? false,
      educationLevelId: dto.educationLevelId,
      occupationId: dto.occupationId,
      familyBackground: dto.familyBackground,
    }

    return this.prisma.matrimonyProfile.upsert({
      where: { memberId: member.id },
      update: data,
      create: { memberId: member.id, ...data },
    })
  }

  async getOwnProfile(userId: string) {
    const member = await this.mustGetMember(userId)
    return this.prisma.matrimonyProfile.findUnique({ where: { memberId: member.id }, include: { preference: true } })
  }

  async upsertPreferences(userId: string, dto: UpsertMatrimonyPreferencesDto) {
    const profile = await this.getOwnProfile(userId)
    if (!profile) throw new NotFoundException('Create your matrimonial profile before setting preferences.')

    return this.prisma.matrimonyPreference.upsert({
      where: { matrimonyProfileId: profile.id },
      update: { ...dto, preferredLocations: dto.preferredLocations as never },
      create: { matrimonyProfileId: profile.id, ...dto, preferredLocations: dto.preferredLocations as never },
    })
  }

  async search(viewerUserId: string, filters: MatrimonySearchFilters) {
    const pageSize = Math.min(filters.pageSize ?? 20, MAX_PAGE_SIZE)
    const page = Math.max(filters.page ?? 1, 1)

    const where: Prisma.MatrimonyProfileWhereInput = {
      isVisible: true,
      educationLevelId: filters.educationLevelId || undefined,
      occupationId: filters.occupationId || undefined,
      member: {
        deletedAt: null,
        gender: filters.gender || undefined,
        maritalStatus: filters.maritalStatus || undefined,
        incomeRange: filters.incomeRange || undefined,
        currentCity: filters.city ? { contains: filters.city, mode: 'insensitive' } : undefined,
        nativeVillage: filters.nativeVillage ? { contains: filters.nativeVillage, mode: 'insensitive' } : undefined,
        dateOfBirth: this.ageRangeToDobFilter(filters.minAge, filters.maxAge),
        skills: filters.skillId ? { some: { skillId: filters.skillId } } : undefined,
        families: filters.subgroup ? { some: { leftAt: null, family: { gotra: { contains: filters.subgroup, mode: 'insensitive' } } } } : undefined,
      },
    }

    const [candidates, total] = await Promise.all([
      this.prisma.matrimonyProfile.findMany({
        where,
        include: { member: true, educationLevel: true, occupation: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.matrimonyProfile.count({ where }),
    ])

    const viewer = { isAuthenticated: true, userId: viewerUserId }
    const visible = candidates.filter((p) => canViewMatrimonyProfile(viewer, { userId: p.member.userId, isVisible: p.isVisible }))
    const data = await Promise.all(
      visible.map(async (p) => ({
        memberId: p.memberId,
        firstName: p.member.firstName,
        gender: p.member.gender,
        age: this.ageFromDob(p.member.dateOfBirth),
        currentCity: p.member.currentCity,
        education: p.educationLevel?.label ?? null,
        occupation: p.occupation?.label ?? null,
        photoUrl: await this.uploads.getSignedUrlForAuthorizedViewer(p.member.profilePhotoId),
      })),
    )
    return { data, total }
  }

  async getDetail(viewerUserId: string, targetMemberId: string) {
    const profile = await this.prisma.matrimonyProfile.findUnique({
      where: { memberId: targetMemberId },
      include: { member: true, preference: true, educationLevel: true, occupation: true },
    })
    if (!profile) throw new NotFoundException('Matrimonial profile not found.')

    const viewer = { isAuthenticated: true, userId: viewerUserId }
    if (!canViewMatrimonyProfile(viewer, { userId: profile.member.userId, isVisible: profile.isVisible })) {
      throw new ForbiddenException('This profile is not visible to you.')
    }

    const viewerMember = await this.prisma.member.findUnique({ where: { userId: viewerUserId } })
    let contact: { mobile?: string | null; email?: string | null } | undefined

    if (viewerMember && viewerMember.id !== targetMemberId) {
      const acceptedContactRequest = await this.prisma.matrimonyInterest.findFirst({
        where: { fromMemberId: viewerMember.id, toMemberId: targetMemberId, kind: 'CONTACT_REQUEST', status: 'ACCEPTED' },
      })
      if (acceptedContactRequest && profile.member.userId) {
        const ownerUser = await this.prisma.user.findUnique({ where: { id: profile.member.userId } })
        contact = { mobile: ownerUser?.mobile, email: ownerUser?.email }
      }
    }

    const photoUrl = await this.uploads.getSignedUrlForAuthorizedViewer(profile.member.profilePhotoId)

    return {
      memberId: profile.memberId,
      firstName: profile.member.firstName,
      lastName: profile.member.lastName,
      gender: profile.member.gender,
      age: this.ageFromDob(profile.member.dateOfBirth),
      currentCity: profile.member.currentCity,
      nativeVillage: profile.member.nativeVillage,
      photoUrl,
      about: profile.about,
      heightCm: profile.heightCm,
      languages: profile.languages,
      allowContactRequests: profile.allowContactRequests,
      education: profile.educationLevel?.label ?? null,
      occupation: profile.occupation?.label ?? null,
      familyBackground: profile.familyBackground,
      preference: profile.preference,
      contactRevealed: !!contact,
      contact,
    }
  }

  async sendInterest(fromUserId: string, dto: SendInterestDto) {
    const fromMember = await this.mustGetMember(fromUserId)
    if (fromMember.id === dto.toMemberId) throw new BadRequestException('You cannot send interest to yourself.')

    const toProfile = await this.prisma.matrimonyProfile.findUnique({ where: { memberId: dto.toMemberId }, include: { member: true } })
    if (!toProfile || !toProfile.isVisible) throw new NotFoundException('Profile not found or not visible.')
    if (dto.kind === 'CONTACT_REQUEST' && !toProfile.allowContactRequests) {
      throw new ForbiddenException('This member does not accept direct contact requests.')
    }

    const interest = await this.prisma.matrimonyInterest.upsert({
      where: { fromMemberId_toMemberId_kind: { fromMemberId: fromMember.id, toMemberId: dto.toMemberId, kind: dto.kind } },
      update: { status: 'PENDING', message: dto.message, respondedAt: null },
      create: { fromMemberId: fromMember.id, toMemberId: dto.toMemberId, kind: dto.kind, message: dto.message },
    })

    if (toProfile.member.userId) {
      await this.notifications.notify({
        recipientId: toProfile.member.userId,
        senderId: fromUserId,
        type: 'matrimony.interest.received',
        title: dto.kind === 'CONTACT_REQUEST' ? 'New contact request' : 'New matrimony interest',
        body: `${fromMember.firstName} ${fromMember.lastName ?? ''} sent you ${dto.kind === 'CONTACT_REQUEST' ? 'a contact request' : 'an interest'}.`,
        data: { interestId: interest.id },
      })
    }

    return interest
  }

  async respondToInterest(actorUserId: string, interestId: string, decision: 'ACCEPTED' | 'DECLINED') {
    const interest = await this.prisma.matrimonyInterest.findUnique({
      where: { id: interestId },
      include: { toMember: true, fromMember: true },
    })
    if (!interest) throw new NotFoundException('Interest not found.')
    if (interest.toMember.userId !== actorUserId) throw new ForbiddenException('Only the recipient can respond to this.')
    if (interest.status !== 'PENDING') throw new ConflictException('This interest has already been resolved.')

    const updated = await this.prisma.matrimonyInterest.update({
      where: { id: interestId },
      data: { status: decision, respondedAt: new Date() },
    })

    if (interest.fromMember.userId) {
      await this.notifications.notify({
        recipientId: interest.fromMember.userId,
        senderId: actorUserId,
        type: 'matrimony.interest.decided',
        title: `Your ${interest.kind === 'CONTACT_REQUEST' ? 'contact request' : 'interest'} was ${decision.toLowerCase()}`,
        body: `${interest.toMember.firstName} ${decision === 'ACCEPTED' ? 'accepted' : 'declined'} your ${interest.kind === 'CONTACT_REQUEST' ? 'contact request' : 'interest'}.`,
        data: { interestId },
      })
    }

    return updated
  }

  async listReceived(userId: string) {
    const member = await this.mustGetMember(userId)
    return this.prisma.matrimonyInterest.findMany({
      where: { toMemberId: member.id },
      include: { fromMember: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async listSent(userId: string) {
    const member = await this.mustGetMember(userId)
    return this.prisma.matrimonyInterest.findMany({
      where: { fromMemberId: member.id },
      include: { toMember: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async save(userId: string, savedMemberId: string) {
    const member = await this.mustGetMember(userId)
    return this.prisma.matrimonySave.upsert({
      where: { memberId_savedMemberId: { memberId: member.id, savedMemberId } },
      update: {},
      create: { memberId: member.id, savedMemberId },
    })
  }

  async unsave(userId: string, savedMemberId: string) {
    const member = await this.mustGetMember(userId)
    await this.prisma.matrimonySave.deleteMany({ where: { memberId: member.id, savedMemberId } })
    return { unsaved: true }
  }

  private async mustGetMember(userId: string) {
    const member = await this.prisma.member.findUnique({ where: { userId } })
    if (!member) throw new NotFoundException('Complete registration before using matrimony features.')
    return member
  }

  private ageFromDob(dob: Date | null): number | null {
    if (!dob) return null
    const diff = Date.now() - dob.getTime()
    return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000))
  }

  private ageRangeToDobFilter(minAge?: number, maxAge?: number) {
    if (minAge == null && maxAge == null) return undefined
    const now = Date.now()
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000
    const gte = maxAge != null ? new Date(now - maxAge * msPerYear) : undefined
    const lte = minAge != null ? new Date(now - minAge * msPerYear) : undefined
    return { gte, lte }
  }
}
