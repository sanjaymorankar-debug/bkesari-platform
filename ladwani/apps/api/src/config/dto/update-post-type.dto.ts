import { IsBoolean, IsOptional, IsString } from 'class-validator'

export class UpdatePostTypeDto {
  @IsOptional()
  @IsString()
  label?: string

  @IsOptional()
  @IsString()
  icon?: string

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
