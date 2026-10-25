import { Module } from '@nestjs/common'
import { DuplicateDetectionService } from './duplicate-detection.service'

@Module({
  providers: [DuplicateDetectionService],
  exports: [DuplicateDetectionService],
})
export class DuplicateDetectionModule {}
