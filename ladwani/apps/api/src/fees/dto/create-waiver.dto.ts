import { IsIn, IsNumber, IsString, Min, MinLength } from 'class-validator'

export class CreateWaiverDto {
  @IsIn(['DISCOUNT', 'WAIVER'])
  type!: 'DISCOUNT' | 'WAIVER'

  @IsNumber()
  @Min(0.01)
  reductionAmount!: number

  @IsString()
  @MinLength(3)
  reason!: string
}
