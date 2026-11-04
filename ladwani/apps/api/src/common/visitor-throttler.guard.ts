import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import { env } from './env'

/**
 * The rate limits, counted per visitor. A visitor is a client IP (see
 * trust-proxy.ts), unless the process that runs this API names the visitor in
 * the header VISITOR_HEADER names (removing any value the browser sent). Each
 * such visitor then gets their own budget, whatever proxies stand in front.
 * LadWani's sign-in is its own (src/auth), so the hub no longer names a
 * signed-in person; the header stays supported for a host that does.
 *
 * Only trusted when VISITOR_HEADER is set. Otherwise a caller could put
 * anything in such a header.
 */
@Injectable()
export class VisitorThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const visitor = namedVisitor(req)
    if (visitor) return `visitor:${visitor}`
    return super.getTracker(req)
  }
}

/** The visitor the trusted VISITOR_HEADER names, if any (the hub sends `ip:<address>`). */
function namedVisitor(req: Record<string, any>): string | undefined {
  const header = env('VISITOR_HEADER')?.toLowerCase()
  const visitor = header ? req.headers?.[header] : undefined
  return typeof visitor === 'string' && visitor ? visitor : undefined
}

/**
 * The client's address as these limits see it, for limits kept elsewhere (the
 * built-in administrators' sign-in, auth.service.ts) and their audit rows: the
 * address the hub names (VISITOR_HEADER, `ip:` dropped), else req.ip
 * (trust-proxy aware). At most 45 characters, the longest IPv6 text.
 */
export function clientAddress(req: Record<string, any>): string {
  const visitor = namedVisitor(req)?.replace(/^ip:/, '') || req.ip || req.socket?.remoteAddress
  return String(visitor || 'unknown').slice(0, 45)
}
