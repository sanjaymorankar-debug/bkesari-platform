import { createPublicKey, verify } from 'crypto'

/**
 * The hub (bkesari.com) forwards each request with `X-Bkesari-Token`, an RS256
 * JWT valid for 60 seconds: `sub` (the bkesari ID), `email`, `role` (this
 * project's role) and `aud` ('ladwani'). It is checked here against the hub's
 * published key set (HUB_JWKS_URL), so no secret is shared with the hub.
 */
export const HUB_TOKEN_HEADER = 'x-bkesari-token'
export const HUB_AUDIENCE = 'ladwani'

export interface HubClaims {
  sub: string
  email: string
  role: string
  aud: string
  iss: string
  exp: number
  iat: number
}

export interface Jwks {
  keys: Array<Record<string, string>>
}

export class HubTokenError extends Error {}

export function verifyHubToken(
  token: string,
  jwks: Jwks,
  opts: { audience?: string; now?: number } = {},
): HubClaims {
  const [h, p, s] = String(token || '').split('.')
  if (!h || !p || !s) throw new HubTokenError('malformed token')
  let header: { alg?: string; kid?: string }
  let claims: HubClaims
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString())
    claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  } catch {
    throw new HubTokenError('malformed token')
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid)
  if (header.alg !== 'RS256' || !jwk) throw new HubTokenError('unknown key')
  const key = createPublicKey({ key: jwk as never, format: 'jwk' })
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) {
    throw new HubTokenError('bad signature')
  }
  if (!claims.exp || claims.exp * 1000 < (opts.now ?? Date.now())) throw new HubTokenError('token expired')
  if (claims.aud !== (opts.audience ?? HUB_AUDIENCE)) throw new HubTokenError('token is for another project')
  if (!claims.sub || !claims.email) throw new HubTokenError('token has no user')
  return claims
}

/** The hub's key set, fetched from HUB_JWKS_URL and kept for five minutes. */
export class HubJwks {
  private cached: { at: number; jwks: Jwks } | null = null

  constructor(private readonly url = process.env.HUB_JWKS_URL, private readonly fetchImpl: typeof fetch = fetch) {}

  async get(): Promise<Jwks> {
    if (!this.url) throw new HubTokenError('HUB_JWKS_URL is not set')
    if (this.cached && Date.now() - this.cached.at < 5 * 60 * 1000) return this.cached.jwks
    const res = await this.fetchImpl(this.url)
    if (!res.ok) throw new HubTokenError(`the hub's key set answered ${res.status}`)
    const jwks = (await res.json()) as Jwks
    this.cached = { at: Date.now(), jwks }
    return jwks
  }

  /** Forget the cache: the hub may have rotated its key. */
  reset() {
    this.cached = null
  }
}
