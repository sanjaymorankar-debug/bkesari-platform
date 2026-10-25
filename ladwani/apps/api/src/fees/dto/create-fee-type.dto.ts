import { IsIn, IsNumber, IsString, Min } from 'class-validator'
import { FEE_FREQUENCIES, type FeeFrequency } from '@community-platform/shared-types'

export class CreateFeeTypeDto {
  @IsString()
  code!: string

  @IsString()
  label!: string

  @IsNumber()
  @Min(0)
  defaultAmount!: number

  @IsIn(FEE_FREQUENCIES)
  frequency!: FeeFrequency
}
