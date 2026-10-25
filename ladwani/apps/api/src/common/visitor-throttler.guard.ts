import { Injectable } from '@nestjs/common'
import { ThrottlerGuard } from '@nestjs/throttler'
import { env } from './env'

/**
 * The rate limits, counted per visitor. Run on its own, a visitor is a client
 * IP (see trust-proxy.ts). Inside the bkesari.com hub process every request has
 * already passed the hub's sign-in, and the hub names the signed-in person in
 * the header VISITOR_HEADER names (removing any value the browser sent). Each
 * person then gets their own budget, whatever proxies stand in front.
 *
 * Only trusted when VISITOR_HEADER is set, which the hub does for the copy it
 * runs. Standalone, a caller could put anything in such a header.
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
