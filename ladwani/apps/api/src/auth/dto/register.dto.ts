import { IsOptional, IsString, MinLength } from 'class-validator'
import { IsEmailAddress, IsIndianMobile, IsStrongPassword } from './fields'

export class RegisterDto {
  @IsString()
  @MinLength(2)
  firstName!: string

  @IsString()
  @MinLength(1)
  lastName!: string

  /**
   * Required: the sign-up code goes here, and it is how the person signs in
   * (owner's decision, 4 Nov 2026: codes by email while SMS is on hold).
   */
  @IsEmailAddress()
  email!: string

  /** Kept on the account; not verified while SMS is on hold. */
  @IsIndianMobile()
  mobile!: string

  /**
   * Optional: email + code is the primary sign-in, so an account can start
   * without a password and add one later through "Forgot password".
   */
  @IsOptional()
  @IsStrongPassword()
  password?: string
}
