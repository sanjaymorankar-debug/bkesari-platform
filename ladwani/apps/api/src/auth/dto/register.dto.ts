import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator'

export class RegisterDto {
  @IsString()
  @MinLength(2)
  firstName!: string

  @IsString()
  @MinLength(1)
  lastName!: string

  @Matches(/^[6-9]\d{9}$/, { message: 'Enter a valid 10-digit Indian mobile number' })
  mobile!: string

  @IsOptional()
  @IsEmail()
  email?: string

  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  password!: string
}
