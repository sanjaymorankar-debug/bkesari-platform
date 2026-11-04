import type { CookieOptions, Request, Response } from 'express'
import { env } from '../common/env'

/**
 * LadWani's own session cookie. It holds the opaque refresh token (hashed at
 * rest in refresh_tokens) and nothing else; the short-lived access token is
 * handed to the page in the response body.
 *
 * Scoped by name AND path, so it never reaches another bkesari project on the
 * same origin: `lw_sid`, Path=/ladwani (LADWANI_COOKIE_PATH; set it to "/" when
 * the app runs at the root, e.g. `next dev` with no BASE_PATH).
 */
export const SESSION_COOKIE = 'lw_sid'
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** The name used before 2026-11: cleared whenever a new session cookie is set. */
export const LEGACY_SESSION_COOKIE = 'refreshToken'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** The path the cookie is scoped to: LADWANI_COOKIE_PATH, else /ladwani. */
export function cookiePath(): string {
  const value = env('COOKIE_PATH')?.trim()
  if (!value || !value.startsWith('/')) return '/ladwani'
  return value.length > 1 ? value.replace(/\/+$/, '') : '/'
}

/** The app's URL prefix, derived from the cookie path: '/ladwani', or '' at the root. */
export function appBase(): string {
  const p = cookiePath()
  return p === '/' ? '' : p
}

/** Plain http to this machine: the one case a Secure cookie would never come back. */
export function isPlainHttpLocalhost(req: Pick<Request, 'protocol' | 'hostname'>): boolean {
  return req.protocol === 'http' && LOCAL_HOSTS.has(String(req.hostname || '').toLowerCase())
}

export function sessionCookieOptions(req: Pick<Request, 'protocol' | 'hostname'>): CookieOptions {
  return {
    httpOnly: true,
    secure: !isPlainHttpLocalhost(req),
    sameSite: 'lax',
    path: cookiePath(),
  }
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(req), maxAge: SESSION_MAX_AGE_MS })
  if (req.cookies?.[LEGACY_SESSION_COOKIE]) res.clearCookie(LEGACY_SESSION_COOKIE)
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(req))
}

export function readSessionCookie(req: Request): string | undefined {
  const value = req.cookies?.[SESSION_COOKIE]
  return typeof value === 'string' && value ? value : undefined
}
