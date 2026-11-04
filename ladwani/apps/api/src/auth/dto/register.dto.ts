import { IsOptional, IsString, MinLength } from 'class-validator'
import { IsEmailAddress, IsOptionalIndianMobile, IsStrongPassword } from './fields'

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

  /**
   * Optional while SMS is on hold (owner's decision D-037): kept on the
   * account when given, one account per number, and verified once SMS is back.
   */
  @IsOptionalIndianMobile()
  mobile?: string

  /**
   * Optional: email + code is the primary sign-in, so an account can start
   * without a password and add one later through "Forgot password".
   */
  @IsOptional()
  @IsStrongPassword()
  password?: string
}
