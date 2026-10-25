import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { GENDERS, type Gender } from '@community-platform/shared-types'

export class UpsertMatrimonyPreferencesDto {
  @IsOptional()
  @IsInt()
  @Min(18)
  minAge?: number

  @IsOptional()
  @IsInt()
  @Max(100)
  maxAge?: number

  @IsOptional()
  @IsIn(GENDERS)
  preferredGender?: Gender

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredLocations?: string[]

  @IsOptional()
  @IsString()
  educationPreference?: string

  @IsOptional()
  @IsString()
  occupationPreference?: string
}
