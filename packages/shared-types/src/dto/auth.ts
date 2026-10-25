import { RoleCode } from '../roles'

export interface RegisterRequestDto {
  firstName: string
  lastName: string
  mobile: string
  email?: string
  password: string
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
