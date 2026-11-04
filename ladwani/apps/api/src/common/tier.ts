/**
 * Which bkesari tier this API runs on, from APP_ENV (the hub's setting, read
 * as it is: a tier belongs to the whole process, not to LadWani alone).
 *
 *   dev | development  -> 'dev'
 *   test | staging     -> 'test'
 *   prod | production  -> 'prod'
 *   unset or blank     -> 'local' (a developer's own machine, CI, `next dev`)
 *   anything else      -> 'unknown', treated like production
 */
export type Tier = 'dev' | 'test' | 'prod' | 'local' | 'unknown'

export function currentTier(appEnv: string | undefined = process.env.APP_ENV): Tier {
  const v = String(appEnv ?? '').trim().toLowerCase()
  if (!v) return 'local'
  if (v === 'dev' || v === 'development') return 'dev'
  if (v === 'test' || v === 'staging') return 'test'
  if (v === 'prod' || v === 'production') return 'prod'
  return 'unknown'
}

/**
 * Whether a one-time code may be handed back in an API answer (`devOtp`) when
 * nothing can deliver it: on the dev tier, or on a local run that is not
 * NODE_ENV=production. Never on the test or production tiers (owner's
 * decision, 4 Nov 2026), and never on an APP_ENV this file does not know.
 * Callers also need "no provider is configured" (auth/code-delivery.service.ts).
 */
export function mayShowCodes(env: NodeJS.ProcessEnv = process.env): boolean {
  const tier = currentTier(env.APP_ENV)
  if (tier === 'dev') return true
  if (tier === 'local') return env.NODE_ENV !== 'production'
  return false
}
