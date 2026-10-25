import { Type } from 'class-transformer'
import { IsBoolean, IsDate, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator'
import { GENDERS, type Gender } from '@community-platform/shared-types'

export class NewMemberDataDto {
  @IsString()
  @MinLength(1)
  firstName!: string

  @IsOptional()
  @IsString()
  middleName?: string

  @IsOptional()
  @IsString()
  lastName?: string

  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateOfBirth?: Date

  @IsOptional()
  @IsString()
  currentCity?: string

  @IsOptional()
  @IsString()
  currentState?: string

  @IsOptional()
  @IsString()
  nativeVillage?: string
}

export class AddNewMemberDto {
  @IsString()
  relatedToMemberId!: string

  @IsString()
  relationshipTypeCode!: string

  @ValidateNested()
  @Type(() => NewMemberDataDto)
  memberData!: NewMemberDataDto

  /** Set true only after the submitter has reviewed possible-duplicate results and wants to proceed anyway (J11). */
  @IsOptional()
  @IsBoolean()
  acknowledgedDuplicates?: boolean
}
