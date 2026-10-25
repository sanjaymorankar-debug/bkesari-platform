import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { FamilyService } from './family.service'
import { MembersService } from '../members/members.service'
import { FamilyAuthorizationService } from '../common/family-authorization/family-authorization.service'
import { CreateFamilyDto } from './dto/create-family.dto'
import { CreateJoinRequestDto } from './dto/create-join-request.dto'
import { InviteExistingMemberDto } from './dto/invite-existing-member.dto'
import { AddNewMemberDto } from '../members/dto/add-new-member.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import { ViewerContextService } from '../common/privacy/viewer-context.service'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('families')
@UseGuards(JwtAuthGuard)
export class FamilyController {
  constructor(
    private families: FamilyService,
    private members: MembersService,
    private familyAuth: FamilyAuthorizationService,
    private viewerContext: ViewerContextService,
  ) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions('family:create')
  @Audited('family.create.submit')
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateFamilyDto) {
    return { data: await this.families.createFamily(user.sub, dto) }
  }

  @Get('search')
  async search(@Query('q') q: string) {
    return { data: await this.families.search(q) }
  }

  @Get('mine')
  async getMine(@CurrentUser() user: JwtPayload) {
    return { data: await this.families.getMine(user.sub) }
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const viewer = await this.viewerContext.build(user.sub)
    const [family, isKarta] = await Promise.all([this.families.getById(id, viewer), this.familyAuth.isKartaOf(user.sub, id)])
    return { data: { ...family, isKarta } }
  }

  @Get(':id/join-requests')
  @UseGuards(PermissionsGuard)
  @Permissions('family:member:add')
  async listJoinRequests(@Param('id') familyId: string, @CurrentUser() user: JwtPayload) {
    await this.familyAuth.assertIsKarta(user.sub, familyId)
    return { data: await this.families.listJoinRequests(familyId) }
  }

  @Get(':id/tree')
  async getTree(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const viewer = await this.viewerContext.build(user.sub)
    return { data: await this.families.getTree(id, viewer) }
  }

  @Post(':id/join-requests')
  @UseGuards(PermissionsGuard)
  @Permissions('family:join')
  @Audited('family.join_request.create')
  async requestToJoin(@Param('id') familyId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateJoinRequestDto) {
    if (!user.memberId) throw new Error('Authenticated user has no member profile.')
    return { data: await this.families.createJoinRequest(familyId, user.memberId, user.sub, dto) }
  }

  @Post(':id/members')
  @UseGuards(PermissionsGuard)
  @Permissions('family:member:add')
  @Audited('family.member.add.submit')
  async addNewMember(@Param('id') familyId: string, @CurrentUser() user: JwtPayload, @Body() dto: AddNewMemberDto) {
    return { data: await this.members.addNewMember(familyId, user.sub, dto) }
  }

  @Post(':id/members/invite-existing')
  @UseGuards(PermissionsGuard)
  @Permissions('family:member:add')
  @Audited('family.member.invite.create')
  async inviteExisting(@Param('id') familyId: string, @CurrentUser() user: JwtPayload, @Body() dto: InviteExistingMemberDto) {
    await this.familyAuth.assertIsKarta(user.sub, familyId)
    return {
      data: await this.families.createJoinRequest(familyId, dto.existingMemberId, user.sub, {
        relatedToMemberId: dto.relatedToMemberId,
        relationshipTypeCode: dto.relationshipTypeCode,
      }),
    }
  }

  @Delete(':id/members/:memberId')
  @UseGuards(PermissionsGuard)
  @Permissions('family:member:remove')
  @Audited('family.member.remove')
  async removeMember(@Param('id') familyId: string, @Param('memberId') memberId: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.members.removeMember(familyId, memberId, user.sub) }
  }
}
