import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { env } from '../common/env'

interface HeaderBag {
  headers: Record<string, string | string[] | undefined>
}

const first = (v: string | string[] | undefined): string => String((Array.isArray(v) ? v[0] : v) ?? '').split(',')[0].trim()

/** Origins trusted besides the API's own host: WEB_ORIGIN (the CORS origin), comma-separated. */
function trustedOrigins(): string[] {
  const configured = env('WEB_ORIGIN') ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000')
  return configured.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean)
}

/**
 * Whether a request was sent by a page on another site. The session cookie is
 * SameSite=Lax, so a cross-site POST arrives without it anyway; this refuses
 * such requests outright, as the hub does for its own forms.
 *
 *   - `Sec-Fetch-Site: cross-site` (set by the browser, not by the page) is refused.
 *   - An `Origin` header, when present, must name this host. The host is the
 *     `Host` header, or `X-Forwarded-Host` that a proxy in front (the `next dev`
 *     rewrite) put there: a page cannot set that header without a CORS
 *     preflight, which only WEB_ORIGIN passes. WEB_ORIGIN itself is trusted.
 *   - No Origin (a same-origin GET, curl, a server) passes.
 */
export function isCrossSiteRequest(req: HeaderBag): boolean {
  if (first(req.headers['sec-fetch-site']).toLowerCase() === 'cross-site') return true
  const origin = first(req.headers.origin)
  if (!origin) return false
  if (origin === 'null') return true
  let host: string
  try {
    host = new URL(origin).host.toLowerCase()
  } catch {
    return true
  }
  const ownHosts = [first(req.headers.host), first(req.headers['x-forwarded-host'])].map((h) => h.toLowerCase()).filter(Boolean)
  if (ownHosts.includes(host)) return false
  return !trustedOrigins().includes(origin.replace(/\/+$/, ''))
}

@Injectable()
export class SameOriginGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (isCrossSiteRequest(ctx.switchToHttp().getRequest<HeaderBag>())) {
      throw new ForbiddenException('Cross-site request refused.')
    }
    return true
  }
}
