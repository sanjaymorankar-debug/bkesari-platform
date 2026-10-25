import { IsDate, IsOptional, IsString } from 'class-validator'
import { Type } from 'class-transformer'

export class BlockDatesDto {
  @Type(() => Date)
  @IsDate()
  dateFrom!: Date

  @Type(() => Date)
  @IsDate()
  dateTo!: Date

  @IsOptional()
  @IsString()
  reason?: string
}
