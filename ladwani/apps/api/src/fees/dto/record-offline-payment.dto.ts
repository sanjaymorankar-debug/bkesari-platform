import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { OFFLINE_PAYMENT_METHODS, type OfflinePaymentMethod } from '@community-platform/shared-types'

export class RecordOfflinePaymentDto {
  @IsNumber()
  @Min(0.01)
  amount!: number

  @IsIn(OFFLINE_PAYMENT_METHODS)
  method!: OfflinePaymentMethod

  @IsOptional()
  @IsString()
  reference?: string
}
