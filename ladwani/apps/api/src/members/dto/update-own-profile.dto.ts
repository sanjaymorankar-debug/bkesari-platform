import { IsArray, IsIn, IsOptional, IsString } from 'class-validator'
import { INCOME_RANGES, type IncomeRange } from '@community-platform/shared-types'

export class UpdateOwnProfileDto {
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
