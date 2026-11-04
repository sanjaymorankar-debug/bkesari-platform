import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto'
import { BadRequestException, ForbiddenException } from '@nestjs/common'

/**
 * The built-in administrators, smorankar and sonalimorankar (D-036): owner
 * accounts in every bkesari project, each an account of that project's own.
 * In LadWani they sign in on LadWani's own sign-in page with their username
 * and the one password whose scrypt hash the hub process holds as
 * BUILTIN_ADMIN_PASSWORD_HASH, get LadWani's top role (ADMIN) and LadWani's
 * own session (lw_sid), like anyone else.
 *
 * Their LadWani rows have the address <name>@builtin.bkesari.com, which can
 * receive nothing. The whole domain is reserved: nobody can sign up with it,
 * ask for a code for it or reset a password with it, and a built-in account
 * has no password of its own (none can be set: 403).
 *
 * THE PASSWORD IS NEVER IN THIS REPOSITORY (it is public). The hash is made
 * by `node scripts/hash-builtin-admin-password.js` at the repository root; the
 * hub's portal/builtin-admins.js makes and checks the same format, and this
 * file checks it the same way. Unset, or not a valid hash: the built-in
 * sign-in is off, and the username is answered like any wrong password.
 */

export const BUILTIN_USERNAMES = ['smorankar', 'sonalimorankar'] as const
export type BuiltinUsername = (typeof BUILTIN_USERNAMES)[number]
export const BUILTIN_EMAIL_DOMAIN = 'builtin.bkesari.com'
export const BUILTIN_HASH_ENV = 'BUILTIN_ADMIN_PASSWORD_HASH'
export const RESERVED_EMAIL_MESSAGE = 'This email address is reserved.'
export const BUILTIN_PASSWORD_MESSAGE = "A built-in administrator's password is set on the server (BUILTIN_ADMIN_PASSWORD_HASH), not here."

/** Tries at the built-in sign-in, counted before the password is checked: per client address and per username, in a sliding window. */
export const BUILTIN_TRIES_PER_IP = 10
export const BUILTIN_TRIES_PER_NAME = 50
export const BUILTIN_WINDOW_MINUTES = 15

const KEY_BYTES = 32

export interface ParsedHash {
  N: number
  r: number
  p: number
  salt: Buffer
  key: Buffer
}

/** The canonical username, or null when it is not one of the built-in accounts. Case and spaces around it do not matter. */
export function normalizeBuiltinUsername(value: unknown): BuiltinUsername | null {
  const name = String(value ?? '').trim().toLowerCase()
  return (BUILTIN_USERNAMES as readonly string[]).includes(name) ? (name as BuiltinUsername) : null
}

/** The address of a built-in account's LadWani row. */
export function builtinEmail(username: BuiltinUsername): string {
  return `${username}@${BUILTIN_EMAIL_DOMAIN}`
}

/** True for an address on the reserved domain, however it is typed. */
export function isReservedEmail(email: unknown): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${BUILTIN_EMAIL_DOMAIN}`)
}

/** A built-in administrator's own LadWani row. */
export function isBuiltinAccount(user: { email?: string | null } | null | undefined): boolean {
  return Boolean(user && isReservedEmail(user.email))
}

/** 400 "This email address is reserved." for an address on the reserved domain. */
export function refuseReservedEmail(email: unknown): void {
  if (isReservedEmail(email)) throw new BadRequestException(RESERVED_EMAIL_MESSAGE)
}

/** 403: a built-in account's password is never set in LadWani. */
export function builtinPasswordRefused(): ForbiddenException {
  return new ForbiddenException(BUILTIN_PASSWORD_MESSAGE)
}

/** The parts of `scrypt:N:r:p:<salt base64url>:<key base64url>`, or null when it is not such a hash (the hub's parseHash). */
export function parseBuiltinHash(value: unknown): ParsedHash | null {
  const parts = String(value ?? '').trim().split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null
  const [N, r, p] = parts.slice(1, 4).map((v) => (/^\d{1,7}$/.test(v) ? Number(v) : 0))
  const salt = Buffer.from(parts[4], 'base64url')
  const key = Buffer.from(parts[5], 'base64url')
  const powerOfTwo = N > 1 && (N & (N - 1)) === 0
  if (!powerOfTwo || N < 2 ** 14 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return null
  if (salt.length < 16 || key.length < KEY_BYTES) return null
  return { N, r, p, salt, key }
}

/** The hash the hub process holds (BUILTIN_ADMIN_PASSWORD_HASH), or null: the built-in sign-in is then off. */
export function configuredBuiltinHash(env: NodeJS.ProcessEnv = process.env): ParsedHash | null {
  return parseBuiltinHash(env[BUILTIN_HASH_ENV])
}

function scrypt(password: string, salt: Buffer, length: number, opts: { N: number; r: number; p: number; maxmem: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, length, opts, (err, key) => (err ? reject(err) : resolve(key))))
}

/**
 * A hash in that format (the hub's hashPassword), for tests and tools: the
 * server only ever checks one. The real one is made by the hub's script.
 */
export async function hashBuiltinPassword(password: string, { N, r, p } = { N: 2 ** 15, r: 8, p: 1 }, salt: Buffer = randomBytes(16)): Promise<string> {
  const key = await scrypt(String(password), salt, KEY_BYTES, { N, r, p, maxmem: 256 * N * r })
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join(':')
}

/** Whether `password` matches the hash, compared in constant time (the hub's verifyPassword). */
export async function verifyBuiltinPassword(password: string, parsed: ParsedHash): Promise<boolean> {
  const got = await scrypt(String(password), parsed.salt, parsed.key.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: 256 * parsed.N * parsed.r })
  return timingSafeEqual(got, parsed.key)
}
