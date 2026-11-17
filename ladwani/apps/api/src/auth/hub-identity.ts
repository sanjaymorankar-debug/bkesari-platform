import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '../common/env'

/**
 * The bkesari hub's signed identity headers (docs/design/bkesari-id.md §3,
 * decision D-039). LadWani runs inside the hub's process (portal/ladwani.js),
 * and for every request under /ladwani/ the hub removes any X-Bkesari-* header
 * the client sent, checks its own session and the person's LadWani grant, and
 * then adds:
 *
 *   X-Bkesari-User     the hub user's id (digits)
 *   X-Bkesari-Email    the confirmed email, lower-case
 *   X-Bkesari-Role     the role of the active grant: member, karta, operator or admin
 *   X-Bkesari-Name     the display name, base64url of UTF-8 (may be empty)
 *   X-Bkesari-Project  ladwani
 *   X-Bkesari-Ts       Unix time in seconds
 *   X-Bkesari-Sig      base64url HMAC-SHA256, key HUB_PROXY_SECRET, over
 *                      bkesari-id-v1\n<project>\n<user>\n<email>\n<role>\n<name>\n<ts>
 *                      (<name> as sent: the base64url text, not the decoded name)
 *
 * They are believed only when HUB_PROXY_SECRET is set here (LADWANI_HUB_PROXY_SECRET
 * wins, as for every LadWani setting), the signature matches (compared in
 * constant time), the project is `ladwani`, |now - ts| < 60 seconds and every
 * field has the contract's form. Anything else, and they are ignored
 * entirely: verifyHubIdentity answers null and LadWani's own sign-in works as
 * before.
 */

export const HUB_PROJECT = 'ladwani'
export const HUB_SIGNATURE_VERSION = 'bkesari-id-v1'
export const HUB_SECRET_ENV = 'HUB_PROXY_SECRET'
/** A signature is good for less than this many seconds either side of now. */
export const HUB_MAX_SKEW_SECONDS = 60

/** The request headers, as Node names them (lower-case). */
export const HUB_HEADER = {
  user: 'x-bkesari-user',
  email: 'x-bkesari-email',
  role: 'x-bkesari-role',
  name: 'x-bkesari-name',
  project: 'x-bkesari-project',
  ts: 'x-bkesari-ts',
  sig: 'x-bkesari-sig',
} as const

/**
 * LadWani's answer to the hub on every response to a request that carried a
 * valid identity: whether LadWani's own second step (its verification of the
 * person) is complete. The hub stores it on the grant and removes the header
 * before the response leaves the hub. What "verified" means: project-state.service.ts.
 */
export const PROJECT_STATE_HEADER = 'X-Bkesari-Project-State'
export type ProjectState = 'verified' | 'pending'

/** 401 for a LadWani session (or access token) that is not the hub person's own. */
export const HUB_OTHER_SESSION = 'This LadWani session belongs to someone else. Reload the page to continue.'

export const HUB_ROLES = ['member', 'karta', 'operator', 'admin'] as const
export type HubRole = (typeof HUB_ROLES)[number]

/**
 * The LadWani roles each hub role grants: MEMBER always, plus the role itself.
 * Granted at sign-in and never removed by the hub sign-in, so a role an
 * administrator changes inside LadWani stays.
 */
export const HUB_ROLE_CODES: Record<HubRole, readonly ('MEMBER' | 'KARTA' | 'OPERATOR' | 'ADMIN')[]> = {
  member: ['MEMBER'],
  karta: ['MEMBER', 'KARTA'],
  operator: ['MEMBER', 'OPERATOR'],
  admin: ['MEMBER', 'ADMIN'],
}

export interface HubIdentity {
  /** The hub user's id: LadWani keeps it as users.hub_user_id. */
  user: string
  /** The confirmed email, lower-case. */
  email: string
  role: HubRole
  /** The display name, decoded; may be empty. */
  name: string
  /** When the hub signed it, Unix seconds. */
  ts: number
}

/** The fields as they travel, for signing (the hub's side; tests use it too). */
export interface HubIdentityFields {
  project: string
  user: string
  email: string
  role: string
  /** base64url of the UTF-8 name, exactly as in X-Bkesari-Name. */
  name: string
  ts: string | number
}

type HeaderBag = Record<string, string | string[] | undefined>

const USER_ID = /^\d{1,20}$/
const TIMESTAMP = /^\d{1,12}$/
const BASE64URL = /^[A-Za-z0-9_-]*$/
/** 32 bytes of HMAC-SHA256 in unpadded base64url. */
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/
const EMAIL = /^[^\s@,]+@[^\s@,]+$/
const MAX_EMAIL = 254
const MAX_NAME_HEADER = 1024

/** The shared secret, or null when it is unset (or blank): the headers are then ignored. */
export function hubSecret(): string | null {
  const value = env(HUB_SECRET_ENV)
  return value && value.trim() ? value : null
}

/** X-Bkesari-Sig for these fields. */
export function signHubIdentity(fields: HubIdentityFields, secret: string): string {
  const input = [HUB_SIGNATURE_VERSION, fields.project, fields.user, fields.email, fields.role, fields.name, String(fields.ts)].join('\n')
  return createHmac('sha256', secret).update(input, 'utf8').digest('base64url')
}

/** base64url of the UTF-8 name, as the hub sends it in X-Bkesari-Name. */
export function encodeHubName(name: string): string {
  return Buffer.from(name, 'utf8').toString('base64url')
}

/** A single header's value. A repeated header (Node joins or lists them) is not the hub's. */
function header(headers: HeaderBag, name: string): string | null {
  const value = headers[name]
  return typeof value === 'string' ? value : null
}

/** The decoded name, or null when the header is not base64url of valid UTF-8. */
function decodeName(raw: string): string | null {
  if (raw.length > MAX_NAME_HEADER || !BASE64URL.test(raw)) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'base64url'))
  } catch {
    return null
  }
}

/**
 * The person the hub vouches for on this request, or null when the headers
 * are absent, unsigned, signed with another key, for another project, too old
 * or too new (|now - ts| >= 60 s), or malformed in any way. `now` is in
 * milliseconds (Date.now()).
 */
export function verifyHubIdentity(
  headers: HeaderBag,
  { secret = hubSecret(), now = Date.now() }: { secret?: string | null; now?: number } = {},
): HubIdentity | null {
  if (!secret) return null
  const user = header(headers, HUB_HEADER.user)
  const email = header(headers, HUB_HEADER.email)
  const role = header(headers, HUB_HEADER.role)
  // The name may be empty; a hub that leaves the header out signed it empty.
  const rawName = headers[HUB_HEADER.name] === undefined ? '' : header(headers, HUB_HEADER.name)
  const project = header(headers, HUB_HEADER.project)
  const ts = header(headers, HUB_HEADER.ts)
  const sig = header(headers, HUB_HEADER.sig)
  if (user === null || email === null || role === null || rawName === null || project === null || ts === null || sig === null) return null

  if (project !== HUB_PROJECT) return null
  if (!USER_ID.test(user) || !TIMESTAMP.test(ts) || !SIGNATURE.test(sig)) return null
  if (email.length > MAX_EMAIL || email !== email.trim().toLowerCase() || !EMAIL.test(email)) return null
  if (!(HUB_ROLES as readonly string[]).includes(role)) return null
  const name = decodeName(rawName)
  if (name === null) return null

  const expected = Buffer.from(signHubIdentity({ project, user, email, role, name: rawName, ts }, secret))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null

  const signedAt = Number(ts)
  if (Math.abs(Math.floor(now / 1000) - signedAt) >= HUB_MAX_SKEW_SECONDS) return null

  return { user, email, role: role as HubRole, name, ts: signedAt }
}

/**
 * First and last name for a new LadWani member from the hub's display name:
 * split at the first space; no name gives the email's local part as the first
 * name. Control characters are dropped, runs of spaces collapsed, and each
 * part kept to 100 characters.
 */
export function splitHubName(name: string, email: string): { firstName: string; lastName: string | null } {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return { firstName: (email.split('@')[0] || email).slice(0, 100), lastName: null }
  const space = clean.indexOf(' ')
  if (space < 0) return { firstName: clean.slice(0, 100), lastName: null }
  return { firstName: clean.slice(0, space).slice(0, 100), lastName: clean.slice(space + 1).slice(0, 100) }
}

// ── This request's hub identity, as the middleware found it ────────────

/**
 * What HubIdentityMiddleware learnt about a request that carried a valid
 * identity: who the hub says it is, and the id of the LadWani user linked to
 * that hub id (null when there is none yet). JwtStrategy uses it to believe
 * only that person's own access token on this request.
 */
export interface HubRequestContext {
  identity: HubIdentity
  localUserId: string | null
}

const contexts = new WeakMap<object, HubRequestContext>()

export function setHubContext(req: object, context: HubRequestContext): void {
  contexts.set(req, context)
}

/** Set only when this request carried a valid identity (and went through HubIdentityMiddleware). */
export function hubContextOf(req: object): HubRequestContext | undefined {
  return contexts.get(req)
}
