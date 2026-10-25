import { IsInt, IsOptional, IsString } from 'class-validator'

export class CreateOccupationDto {
  @IsString()
  code!: string

  @IsString()
  label!: string

  @IsOptional()
  @IsInt()
  sortOrder?: number
}
