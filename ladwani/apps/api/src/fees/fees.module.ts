import { Module } from '@nestjs/common'
import { FeesService } from './fees.service'
import { FeesController } from './fees.controller'
import { DonationsService } from './donations.service'
import { DonationsController } from './donations.controller'
import { ApprovalsModule } from '../common/approvals/approvals.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { FamilyAuthorizationModule } from '../common/family-authorization/family-authorization.module'

@Module({
  imports: [ApprovalsModule, NotificationsModule, FamilyAuthorizationModule],
  providers: [FeesService, DonationsService],
  controllers: [FeesController, DonationsController],
  exports: [FeesService, DonationsService],
})
export class FeesModule {}
