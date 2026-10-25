import { Module } from '@nestjs/common'
import { ViewerContextService } from './viewer-context.service'

@Module({
  providers: [ViewerContextService],
  exports: [ViewerContextService],
})
export class PrivacyModule {}
