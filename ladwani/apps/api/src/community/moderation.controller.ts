import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { CommunityService } from './community.service'
import { ModeratePostDto } from './dto/moderate-post.dto'
import { ResolveReportDto } from './dto/resolve-report.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('moderation')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('moderation:review')
export class ModerationController {
  constructor(private community: CommunityService) {}

  @Get('queue')
  async queue() {
    return { data: await this.community.listModerationQueue() }
  }

  @Post('posts/:id/decide')
  @Audited('community.post.moderate')
  async decidePost(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: ModeratePostDto) {
    return { data: await this.community.moderatePost(user.sub, id, dto.decision, dto.note) }
  }

  @Post('reports/:id/resolve')
  @Audited('community.report.resolve')
  async resolveReport(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: ResolveReportDto) {
    return { data: await this.community.resolveReport(user.sub, id, dto.decision) }
  }
}
