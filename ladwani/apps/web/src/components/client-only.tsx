'use client'

import { useSyncExternalStore, type ReactNode } from 'react'

const subscribe = () => () => {}

/**
 * Renders `children` only in the browser, after hydration. The [param] pages
 * use it so the static export's one shell per route carries no placeholder
 * content, and the page first renders when the real id can be read from the
 * address bar (src/lib/route-params.ts).
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const inBrowser = useSyncExternalStore(subscribe, () => true, () => false)
  return <>{inBrowser ? children : fallback}</>
}
