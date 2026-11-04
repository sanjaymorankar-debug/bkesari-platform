import { RoleCode } from '../roles'

export interface RegisterRequestDto {
  firstName: string
  lastName: string
  /** Required: the sign-up code is emailed here (SMS is on hold). */
  email: string
  /** Kept on the account; not verified while SMS is on hold. */
  mobile: string
  /** Optional: an account can start with the emailed code and set one later. */
  password?: string
}

export interface LoginRequestDto {
  identifier: string
  password: string
}

export interface AuthUserDto {
  id: string
  roles: RoleCode[]
  memberId: string | null
}

export interface LoginResponseDto {
  accessToken: string
  user: AuthUserDto
}

export interface VerifyOtpRequestDto {
  userId: string
  otp: string
}
