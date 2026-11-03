import { Type } from 'class-transformer'
import { IsArray, IsDate, IsIn, IsOptional, IsString, MaxDate } from 'class-validator'
import { GENDERS, INCOME_RANGES, type Gender, type IncomeRange } from '@community-platform/shared-types'

export class UpdateOwnProfileDto {
  /** Set by the person themself at sign-up (web /sign-up, step 2). */
  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  @MaxDate(() => new Date(), { message: 'Date of birth cannot be in the future' })
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

  @IsOptional()
  @IsString()
  nativeDistrict?: string

  @IsOptional()
  @IsString()
  nativeState?: string

  @IsOptional()
  @IsString()
  educationLevelId?: string

  @IsOptional()
  @IsString()
  occupationId?: string

  @IsOptional()
  @IsString()
  employerOrBusiness?: string

  @IsOptional()
  @IsIn(INCOME_RANGES)
  incomeRange?: IncomeRange

  @IsOptional()
  @IsString()
  bio?: string

  /** Replaces the member's full skill set when provided — not merged. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skillIds?: string[]
}
