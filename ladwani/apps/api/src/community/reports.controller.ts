import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { CommunityService } from './community.service'
import { CreateMemberReportDto } from './dto/create-member-report.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

/** Reports against a member profile directly, as opposed to a post/comment (handled by their own controllers). */
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private community: CommunityService) {}

  @Post()
  @Audited('community.member.report')
  async reportMember(@CurrentUser() user: JwtPayload, @Body() dto: CreateMemberReportDto) {
    return { data: await this.community.createReport(user.sub, { memberId: dto.memberId }, dto.reason) }
  }
}
