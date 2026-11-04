/** One-time codes (docs/17 §1): 6 digits, bcrypt-hashed, 10 minutes, 3 sent per account per hour. */
export const OTP_TTL_MINUTES = 10
export const OTP_SENDS_PER_HOUR = 3
/** Tries one code allows; a wrong one at the limit voids the code. */
export const OTP_MAX_TRIES = 5
