import { IsIndianMobile, IsOtp } from './fields'

export class SendOtpDto {
  @IsIndianMobile()
  mobile!: string
}

export class OtpLoginDto {
  @IsIndianMobile()
  mobile!: string

  @IsOtp()
  otp!: string
}
