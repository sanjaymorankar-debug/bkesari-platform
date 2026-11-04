import { IsString, MinLength } from 'class-validator'

export class LoginDto {
  /** An email address, a mobile number, or a built-in administrator's username (smorankar, sonalimorankar). */
  @IsString()
  @MinLength(1)
  identifier!: string

  @IsString()
  @MinLength(1)
  password!: string
}
