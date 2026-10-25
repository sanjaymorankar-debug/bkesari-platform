import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { PAYMENT_PURPOSE_TYPES, type PaymentPurposeType } from '@community-platform/shared-types'

export class CreateOrderDto {
  @IsIn(PAYMENT_PURPOSE_TYPES)
  purposeType!: PaymentPurposeType

  @IsString()
  purposeId!: string

  @IsNumber()
  @Min(0.01)
  amount!: number

  @IsOptional()
  @IsString()
  idempotencyKey?: string
}
