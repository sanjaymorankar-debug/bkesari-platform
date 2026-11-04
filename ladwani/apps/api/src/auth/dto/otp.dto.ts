import { ValidateIf } from 'class-validator'
import { IsEmailAddress, IsIndianMobile, IsOtp } from './fields'

/**
 * { email } (the default while SMS is on hold) or { mobile }. With neither,
 * the email is what is asked for; with both, the email is used.
 */
class CodeTargetDto {
  @ValidateIf((o: CodeTargetDto) => o.mobile === undefined || o.email !== undefined)
  @IsEmailAddress()
  email?: string

  @ValidateIf((o: CodeTargetDto) => o.mobile !== undefined && o.email === undefined)
  @IsIndianMobile()
  mobile?: string
}

export class SendOtpDto extends CodeTargetDto {}

export class OtpLoginDto extends CodeTargetDto {
  @IsOtp()
  otp!: string
}
