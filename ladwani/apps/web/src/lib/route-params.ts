'use client'

import { useParams, usePathname } from 'next/navigation'
import { PLACEHOLDER } from './route-placeholder'

export { PLACEHOLDER }

/**
 * The [params] of `pattern`, the route as written under src/app (for example
 * '/family/[id]/fees/[invoiceId]'), matched against `pathname` with the base
 * path removed. Null when the path does not fit the pattern.
 */
export function paramsFromPath(pattern: string, pathname: string, basePath = ''): Record<string, string> | null {
  let path = pathname
  if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) path = path.slice(basePath.length)
  const want = pattern.split('/').filter(Boolean)
  const got = path.split('/').filter(Boolean)
  if (want.length !== got.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < want.length; i++) {
    const name = /^\[(\w+)\]$/.exec(want[i])?.[1]
    if (name) {
      try {
        params[name] = decodeURIComponent(got[i])
      } catch {
        return null
      }
    } else if (want[i] !== got[i]) {
      return null
    }
  }
  return params
}

/**
 * useParams() that also works in the static export: when Next reports the
 * placeholder, the values come from the path instead. Next's own path
 * (usePathname, without the base path) comes first: during an in-app move it
 * already names the new page while the address bar still shows the old one.
 * The address bar is the fallback for the first load. Pages using this render
 * only in the browser (see src/components/client-only.tsx).
 */
export function useRouteParams<T extends Record<string, string>>(pattern: string): T {
  const params = useParams() as T
  const nextPath = usePathname()
  if (typeof window === 'undefined' || !Object.values(params).includes(PLACEHOLDER)) return params
  const real = (found: Record<string, string> | null) => found && !Object.values(found).includes(PLACEHOLDER)
  const fromNext = paramsFromPath(pattern, nextPath ?? '')
  if (real(fromNext)) return fromNext as T
  const fromBar = paramsFromPath(pattern, window.location.pathname, process.env.NEXT_PUBLIC_BASE_PATH ?? '')
  if (real(fromBar)) return fromBar as T
  return params
}
