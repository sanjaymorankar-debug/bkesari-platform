import { IsBoolean, IsOptional, IsString } from 'class-validator'

export class CreatePostTypeDto {
  @IsString()
  code!: string

  @IsString()
  label!: string

  @IsOptional()
  @IsString()
  icon?: string

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean
}
