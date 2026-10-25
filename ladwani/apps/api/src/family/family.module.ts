import { Module } from '@nestjs/common'
import { FamilyService } from './family.service'
import { FamilyController } from './family.controller'
import { JoinRequestsController } from './join-requests.controller'
import { MembersModule } from '../members/members.module'
import { ApprovalsModule } from '../common/approvals/approvals.module'
import { DuplicateDetectionModule } from '../common/duplicate-detection/duplicate-detection.module'
import { RelationshipsModule } from '../common/relationships/relationships.module'
import { FamilyAuthorizationModule } from '../common/family-authorization/family-authorization.module'
import { PrivacyModule } from '../common/privacy/privacy.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [MembersModule, ApprovalsModule, DuplicateDetectionModule, RelationshipsModule, FamilyAuthorizationModule, PrivacyModule, NotificationsModule],
  providers: [FamilyService],
  controllers: [FamilyController, JoinRequestsController],
  exports: [FamilyService],
})
export class FamilyModule {}
