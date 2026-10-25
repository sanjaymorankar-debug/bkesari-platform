import { Type } from 'class-transformer'
import { IsDate, IsString } from 'class-validator'

export class CreateFinancialYearDto {
  @IsString()
  label!: string

  @Type(() => Date)
  @IsDate()
  startDate!: Date

  @Type(() => Date)
  @IsDate()
  endDate!: Date
}
