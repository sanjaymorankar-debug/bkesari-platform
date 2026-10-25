import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { NotificationsService } from './notifications.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: JwtPayload, @Query('unread') unread?: string) {
    return { data: await this.notifications.list(user.sub, unread === 'true') }
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.notifications.markRead(id, user.sub) }
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: JwtPayload) {
    return { data: await this.notifications.markAllRead(user.sub) }
  }
}
