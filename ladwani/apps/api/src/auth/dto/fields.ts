import { applyDecorators } from '@nestjs/common'
import { Transform } from 'class-transformer'
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator'

/**
 * An Indian mobile number as people type it -- "+91 98765 43210",
 * "098765-43210" -- reduced to its 10 digits. Anything else is left as typed,
 * so the validator below reports it.
 */
export function normalizeMobile(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const digits = value.replace(/[\s().-]/g, '')
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits)
  return m ? m[1] : value.trim()
}

export const MOBILE_PATTERN = /^[6-9]\d{9}$/

/** A 10-digit Indian mobile number (spaces, +91 or a leading 0 are accepted and removed). */
export function IsIndianMobile() {
  return applyDecorators(
    Transform(({ value }) => normalizeMobile(value)),
    Matches(MOBILE_PATTERN, { message: 'Enter a valid 10-digit Indian mobile number' }),
  )
}

/** An email address as people type it, spaces around it removed (AuthService lower-cases it). */
export function IsEmailAddress() {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)),
    IsString({ message: 'Enter a valid email address' }),
    MaxLength(254, { message: 'Enter a valid email address' }),
    IsEmail({}, { message: 'Enter a valid email address' }),
  )
}

/** The password rule, the same at sign-up and at reset. */
export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(8),
    MaxLength(128),
    Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' }),
    Matches(/[0-9]/, { message: 'Password must contain at least one number' }),
  )
}

/** A 6-digit one-time code. */
export function IsOtp() {
  return applyDecorators(
    Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s/g, '') : value)),
    Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' }),
  )
}
