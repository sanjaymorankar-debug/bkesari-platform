import { Module } from '@nestjs/common'
import { RelationshipsService } from './relationships.service'

@Module({
  providers: [RelationshipsService],
  exports: [RelationshipsService],
})
export class RelationshipsModule {}
