import { Module } from '@nestjs/common'
import { AssetsService } from './assets.service'
import { AssetsController } from './assets.controller'
import { ApprovalsModule } from '../common/approvals/approvals.module'

@Module({
  imports: [ApprovalsModule],
  providers: [AssetsService],
  controllers: [AssetsController],
  exports: [AssetsService],
})
export class AssetsModule {}
