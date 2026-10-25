import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { MatrimonyService } from './matrimony.service'
import { UpsertMatrimonyProfileDto } from './dto/upsert-profile.dto'
import { UpsertMatrimonyPreferencesDto } from './dto/upsert-preferences.dto'
import { SendInterestDto } from './dto/send-interest.dto'
import { RespondInterestDto } from './dto/respond-interest.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('matrimony')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('matrimony:manage:own')
export class MatrimonyController {
  constructor(private matrimony: MatrimonyService) {}

  @Get('profile')
  async getOwnProfile(@CurrentUser() user: JwtPayload) {
    return { data: await this.matrimony.getOwnProfile(user.sub) }
  }

  @Put('profile')
  @Audited('matrimony.profile.upsert')
  async upsertProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpsertMatrimonyProfileDto) {
    return { data: await this.matrimony.upsertProfile(user.sub, dto) }
  }

  @Put('preferences')
  @Audited('matrimony.preferences.upsert')
  async upsertPreferences(@CurrentUser() user: JwtPayload, @Body() dto: UpsertMatrimonyPreferencesDto) {
    return { data: await this.matrimony.upsertPreferences(user.sub, dto) }
  }

  @Get('search')
  async search(
    @CurrentUser() user: JwtPayload,
    @Query('minAge') minAge?: string,
    @Query('maxAge') maxAge?: string,
    @Query('gender') gender?: string,
    @Query('city') city?: string,
    @Query('nativeVillage') nativeVillage?: string,
    @Query('educationLevelId') educationLevelId?: string,
    @Query('occupationId') occupationId?: string,
    @Query('incomeRange') incomeRange?: string,
    @Query('maritalStatus') maritalStatus?: string,
    @Query('skillId') skillId?: string,
    @Query('subgroup') subgroup?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const result = await this.matrimony.search(user.sub, {
      minAge: minAge ? Number(minAge) : undefined,
      maxAge: maxAge ? Number(maxAge) : undefined,
      gender,
      city,
      nativeVillage,
      educationLevelId,
      occupationId,
      incomeRange,
      maritalStatus,
      skillId,
      subgroup,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    })
    return { data: result.data, total: result.total }
  }

  @Get('profiles/:memberId')
  async getDetail(@Param('memberId') memberId: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.matrimony.getDetail(user.sub, memberId) }
  }

  @Post('interests')
  @Audited('matrimony.interest.send')
  async sendInterest(@CurrentUser() user: JwtPayload, @Body() dto: SendInterestDto) {
    return { data: await this.matrimony.sendInterest(user.sub, dto) }
  }

  @Post('interests/:id/respond')
  @Audited('matrimony.interest.respond')
  async respondToInterest(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: RespondInterestDto) {
    return { data: await this.matrimony.respondToInterest(user.sub, id, dto.decision) }
  }

  @Get('interests/received')
  async listReceived(@CurrentUser() user: JwtPayload) {
    return { data: await this.matrimony.listReceived(user.sub) }
  }

  @Get('interests/sent')
  async listSent(@CurrentUser() user: JwtPayload) {
    return { data: await this.matrimony.listSent(user.sub) }
  }

  @Post('saves/:memberId')
  async save(@Param('memberId') memberId: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.matrimony.save(user.sub, memberId) }
  }

  @Delete('saves/:memberId')
  async unsave(@Param('memberId') memberId: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.matrimony.unsave(user.sub, memberId) }
  }
}
