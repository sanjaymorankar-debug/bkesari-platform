/**
 * Express's `trust proxy` setting, read from TRUST_PROXY.
 *
 * The rate limits (ThrottlerGuard: 20 requests a minute, 5 logins per 15
 * minutes, 5 sign-ups an hour) count per client IP. Behind a proxy, every
 * request arrives from the proxy, so without this all visitors share one
 * budget. On Hostinger the dev chain is hub -> web -> API, each behind the
 * host's own front end, and every hop appends to X-Forwarded-For.
 *
 * Set it to the addresses of those hops, e.g. "loopback, 203.0.113.10" (the
 * server's IP). Express then takes the nearest address that is not one of
 * them, which a caller cannot forge. A hop count ("3") also works but trusts
 * whatever a direct caller puts at that depth. Unset: trust nothing, as before.
 */
export function trustProxySetting(value: string | undefined): boolean | number | string | undefined {
  const v = value?.trim()
  if (!v) return undefined
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^\d+$/.test(v)) return Number(v)
  return v
}
