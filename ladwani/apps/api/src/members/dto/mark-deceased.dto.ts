import { Type } from 'class-transformer'
import { IsDate, IsOptional, IsString } from 'class-validator'

export class MarkDeceasedDto {
  @Type(() => Date)
  @IsDate()
  deceasedAt!: Date

  @IsOptional()
  @IsString()
  deceasedPlace?: string

  @IsOptional()
  @IsString()
  memorialNote?: string
}
