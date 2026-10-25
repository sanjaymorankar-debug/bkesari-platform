import { IsInt, IsOptional, IsString } from 'class-validator'

export class CreateEducationLevelDto {
  @IsString()
  code!: string

  @IsString()
  label!: string

  @IsOptional()
  @IsInt()
  sortOrder?: number
}
