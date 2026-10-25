import { Module } from '@nestjs/common'
import { ApprovalsService } from './approvals.service'

@Module({
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
