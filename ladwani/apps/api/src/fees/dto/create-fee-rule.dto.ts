import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class CreateFeeRuleDto {
  @IsString()
  feeTypeCode!: string

  @IsString()
  financialYearLabel!: string

  @IsNumber()
  @Min(0)
  amount!: number

  @IsOptional()
  @IsString()
  areaId?: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  lateFeeAmount?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  gracePeriodDays?: number
}
