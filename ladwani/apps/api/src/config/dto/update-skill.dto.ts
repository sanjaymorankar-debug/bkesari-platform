import { IsBoolean, IsOptional, IsString } from 'class-validator'

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  label?: string

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
