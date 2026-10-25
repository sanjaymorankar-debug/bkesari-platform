import { Module } from '@nestjs/common'
import { CommunityService } from './community.service'
import { PostsController } from './posts.controller'
import { CommentsController } from './comments.controller'
import { ReportsController } from './reports.controller'
import { ModerationController } from './moderation.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { PrivacyModule } from '../common/privacy/privacy.module'

@Module({
  imports: [NotificationsModule, PrivacyModule],
  providers: [CommunityService],
  controllers: [PostsController, CommentsController, ReportsController, ModerationController],
})
export class CommunityModule {}
