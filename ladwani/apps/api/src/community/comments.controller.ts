import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common'
import { CommunityService } from './community.service'
import { ReactDto } from './dto/react.dto'
import { CreateReportDto } from './dto/create-report.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('comments')
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private community: CommunityService) {}

  @Post(':id/react')
  async react(@Param('id') commentId: string, @CurrentUser() user: JwtPayload, @Body() dto: ReactDto) {
    return { data: await this.community.react(user.sub, { commentId }, dto.type) }
  }

  @Delete(':id/react')
  async removeReaction(@Param('id') commentId: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.community.removeReaction(user.sub, { commentId }) }
  }

  @Post(':id/report')
  @Audited('community.comment.report')
  async report(@Param('id') commentId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateReportDto) {
    return { data: await this.community.createReport(user.sub, { commentId }, dto.reason) }
  }
}
