import { IsString } from 'class-validator'

export class VerifyPaymentDto {
  @IsString()
  gatewayPaymentId!: string

  @IsString()
  gatewaySignature!: string
}
