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
    const header = env('VISITOR_HEADER')?.toLowerCase()
    const visitor = header ? req.headers?.[header] : undefined
    if (typeof visitor === 'string' && visitor) return `visitor:${visitor}`
    return super.getTracker(req)
  }
}
