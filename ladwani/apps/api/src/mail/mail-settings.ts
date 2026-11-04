/**
 * LadWani's outgoing mail settings (SMTP: Hostinger email, owner's decision of
 * 4 Nov 2026). The same names every bkesari app reads, Education's Laravel and
 * the hub's portal/notify.js included:
 *
 *   MAIL_HOST          smtp.hostinger.com. Unset: no mail is sent.
 *   MAIL_PORT          465 (TLS from the first byte, the default) or 587 (STARTTLS)
 *   MAIL_USERNAME      the mailbox, e.g. no-reply@bkesari.com
 *   MAIL_PASSWORD      its password
 *   MAIL_FROM_ADDRESS  the sender address (default: MAIL_USERNAME)
 *   MAIL_FROM_NAME     the sender name (default: "LadWani · bkesari")
 *   MAIL_SCHEME        optional, as Laravel's: smtps (TLS from the first byte) or smtp (STARTTLS)
 *
 * The names the owner set on the server also work (4 Nov 2026): SMTP_USER (or
 * SMTP_USERNAME) for MAIL_USERNAME, SMTP_PASSWORD (or SMTP_PASS) for
 * MAIL_PASSWORD, SMTP_HOST and SMTP_PORT. With a mailbox but no host, the host
 * is Hostinger's, smtp.hostinger.com, on 465 (decision D-034).
 *
 * LadWani runs inside the hub's process and shares its environment, so each
 * may be set for LadWani alone with a LADWANI_ prefix (LADWANI_MAIL_FROM_NAME
 * beats MAIL_FROM_NAME). A blank value counts as unset, as in the hub.
 *
 * Read on every send rather than once at start-up, so a changed setting needs
 * no restart and tests can set their own.
 */

export const DEFAULT_FROM_NAME = 'LadWani · bkesari'

export interface MailSettings {
  host: string
  port: number
  /** TLS from the first byte (port 465, or MAIL_SCHEME=smtps). */
  secure: boolean
  /** Refuse to send unless a plain connection upgrades with STARTTLS. Off only for a mail catcher on this machine. */
  requireTLS: boolean
  auth?: { user: string; pass: string }
  from: { name: string; address: string }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

/** LADWANI_<name>, else <name>; blank is unset. Passwords are taken as typed, never trimmed. */
function pick(env: NodeJS.ProcessEnv, name: string, trim = true): string {
  for (const key of [`LADWANI_${name}`, name]) {
    const raw = env[key]
    if (raw !== undefined && raw.trim() !== '') return trim ? raw.trim() : raw
  }
  return ''
}

/** The settings in force, or null when mail is not configured (no host, no sender, or a port that is not one). */
/** The first of `names` that is set (each with its LADWANI_ form first). */
function first(env: NodeJS.ProcessEnv, names: string[], trim = true): string {
  for (const n of names) {
    const v = pick(env, n, trim)
    if (v) return v
  }
  return ''
}

export const HOSTINGER_SMTP_HOST = 'smtp.hostinger.com'

export function mailSettings(env: NodeJS.ProcessEnv = process.env): MailSettings | null {
  const user = first(env, ['MAIL_USERNAME', 'SMTP_USER', 'SMTP_USERNAME'])
  const host = first(env, ['MAIL_HOST', 'SMTP_HOST']) || (user ? HOSTINGER_SMTP_HOST : '')
  if (!host) return null
  const port = Number(first(env, ['MAIL_PORT', 'SMTP_PORT']) || 465)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const address = pick(env, 'MAIL_FROM_ADDRESS') || user
  if (!address) return null
  const scheme = pick(env, 'MAIL_SCHEME').toLowerCase()
  const secure = scheme ? scheme === 'smtps' : port === 465
  return {
    host,
    port,
    secure,
    requireTLS: !secure && !LOOPBACK.has(host.toLowerCase()),
    auth: user ? { user, pass: first(env, ['MAIL_PASSWORD', 'SMTP_PASSWORD', 'SMTP_PASS'], false) } : undefined,
    from: { name: pick(env, 'MAIL_FROM_NAME') || DEFAULT_FROM_NAME, address },
  }
}

/** "asha@example.com" -> "a***@example.com", for logs. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@')
  if (at < 1) return '***'
  return `${address[0]}***${address.slice(at)}`
}

/**
 * A provider's error text, safe to log: any address in it masked (servers
 * quote the rejected recipient) and any 6-digit run hidden, in case it is a code.
 */
export function scrubForLog(text: string): string {
  return text
    .replace(/[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g, (m) => maskEmail(m))
    .replace(/\b\d{6}\b/g, '******')
}
