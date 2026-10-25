import { Module } from '@nestjs/common'
import { MembersService } from './members.service'
import { MembersController } from './members.controller'
import { ApprovalsModule } from '../common/approvals/approvals.module'
import { DuplicateDetectionModule } from '../common/duplicate-detection/duplicate-detection.module'
import { RelationshipsModule } from '../common/relationships/relationships.module'
import { FamilyAuthorizationModule } from '../common/family-authorization/family-authorization.module'
import { PrivacyModule } from '../common/privacy/privacy.module'

@Module({
  imports: [ApprovalsModule, DuplicateDetectionModule, RelationshipsModule, FamilyAuthorizationModule, PrivacyModule],
  providers: [MembersService],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
