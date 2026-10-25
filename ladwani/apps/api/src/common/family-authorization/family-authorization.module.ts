import { Module } from '@nestjs/common'
import { FamilyAuthorizationService } from './family-authorization.service'

@Module({
  providers: [FamilyAuthorizationService],
  exports: [FamilyAuthorizationService],
})
export class FamilyAuthorizationModule {}
