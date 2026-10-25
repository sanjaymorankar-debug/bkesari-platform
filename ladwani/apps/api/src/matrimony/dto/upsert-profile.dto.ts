import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class UpsertMatrimonyProfileDto {
  @IsOptional()
  @IsString()
  about?: string

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(250)
  heightCm?: number

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[]

  @IsOptional()
  @IsBoolean()
  allowContactRequests?: boolean

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean

  /** Required the first time isVisible is set true — docs/09-privacy-architecture.md §62. */
  @IsOptional()
  @IsBoolean()
  consentGranted?: boolean

  @IsOptional()
  @IsString()
  educationLevelId?: string

  @IsOptional()
  @IsString()
  occupationId?: string

  @IsOptional()
  @IsString()
  familyBackground?: string
}
