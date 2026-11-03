import { IsString, MaxLength, MinLength } from 'class-validator'
import { IsOtp, IsStrongPassword } from './fields'

export class ForgotPasswordDto {
  /** The account's email or mobile number, as at sign-in. */
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string

  @IsOtp()
  otp!: string

  @IsStrongPassword()
  password!: string
}
