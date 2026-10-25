import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApprovalQueueService } from './approval-queue.service'
import { DecideApprovalDto } from './dto/decide-approval.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('approvals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('approval:review')
export class ApprovalQueueController {
  constructor(private queue: ApprovalQueueService) {}

  @Get()
  async list(@Query('status') status?: string) {
    return { data: await this.queue.list(status) }
  }

  @Post(':id/decide')
  @Audited('approval.decide')
  async decide(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: DecideApprovalDto) {
    return { data: await this.queue.decide(id, user.sub, dto.decision, dto.note) }
  }
}
