import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator'
import { IsIndianMobile, IsStrongPassword } from './fields'

export class RegisterDto {
  @IsString()
  @MinLength(2)
  firstName!: string

  @IsString()
  @MinLength(1)
  lastName!: string

  @IsIndianMobile()
  mobile!: string

  @IsOptional()
  @IsEmail()
  email?: string

  /**
   * Optional: mobile + OTP is the primary sign-in, so an account can start
   * without a password and add one later through "Forgot password".
   */
  @IsOptional()
  @IsStrongPassword()
  password?: string
}
