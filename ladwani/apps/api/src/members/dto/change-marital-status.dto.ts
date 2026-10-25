import { Type } from 'class-transformer'
import { IsDate, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { MARITAL_STATUSES, type MaritalStatus } from '@community-platform/shared-types'
import { NewMemberDataDto } from './add-new-member.dto'

export class ChangeMaritalStatusDto {
  @IsIn(MARITAL_STATUSES)
  status!: MaritalStatus

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveDate?: Date

  /** Only meaningful when status is MARRIED — how the spouse is being recorded (J3 step 2). */
  @IsOptional()
  @IsIn(['EXISTING_MEMBER', 'NEW_MEMBER', 'NON_COMMUNITY'])
  spouseMode?: 'EXISTING_MEMBER' | 'NEW_MEMBER' | 'NON_COMMUNITY'

  @IsOptional()
  @IsString()
  spouseMemberId?: string

  @IsOptional()
  @IsString()
  externalSpouseName?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => NewMemberDataDto)
  newSpouseData?: NewMemberDataDto
}
