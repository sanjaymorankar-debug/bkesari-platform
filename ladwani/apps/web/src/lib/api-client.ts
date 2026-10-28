'use client'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message)
  }
}

// The API is reached through this app's own /api/v1 rewrite (next.config.js),
// so behind a BASE_PATH the URL must carry the prefix too: Next adds it to
// links and routing, but never to a fetch() string.
const API_BASE = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/api/v1`

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
  if (typeof window !== 'undefined') {
    if (token) window.localStorage.setItem('accessToken', token)
    else window.localStorage.removeItem('accessToken')
  }
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken
  if (typeof window !== 'undefined') {
    accessToken = window.localStorage.getItem('accessToken')
  }
  return accessToken
}

export interface HubSession {
  accessToken: string
  user: { id: string; roles: string[]; memberId: string | null }
}

let hubSignIn: Promise<HubSession | null> | null = null

/**
 * Behind bkesari.com the hub signs every forwarded request, so a visitor who
 * signed in there is signed in here with no second password. The attempt is
 * shared and made once per page load: AuthProvider and any request that finds
 * no session (a deep link opened straight onto a data page) wait on the same
 * promise instead of racing it. Resolves to null when there is no hub access.
 */
export function signInViaHub(): Promise<HubSession | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  hubSignIn ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/hub`, { method: 'POST', credentials: 'include' })
      if (!res.ok) return null
      const session = (await res.json())?.data as HubSession | undefined
      if (!session?.accessToken) return null
      setAccessToken(session.accessToken)
      window.localStorage.setItem('authUser', JSON.stringify(session.user))
      return session
    } catch {
      return null
    }
  })()
  return hubSignIn
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  // No session yet: let the hub sign-in finish before the first call goes out.
  if (!path.startsWith('/auth/') && !getAccessToken()) await signInViaHub()
  const token = getAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await tryRefresh()
    if (refreshed) return request<T>(method, path, body, false)
    // Expired LadWani session: the hub may still vouch for the visitor.
    if (!path.startsWith('/auth/') && (await signInViaHub())) return request<T>(method, path, body, false)
  }

  const text = await res.text()
  const json = text ? JSON.parse(text) : null

  if (!res.ok) {
    throw new ApiError(json?.message ?? 'Request failed', res.status, json)
  }
  return json?.data as T
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    if (!res.ok) return false
    const json = await res.json()
    setAccessToken(json?.data?.accessToken ?? null)
    return true
  } catch {
    return false
  }
}

/**
 * Plain <a href> navigation can't carry the Authorization header the JWT
 * guard requires, so file-download endpoints (CSV exports) go through this
 * instead — fetch with the header, then hand the caller a Blob to save via
 * a client-side object URL.
 */
async function requestBlob(path: string, retry = true): Promise<Blob> {
  if (!getAccessToken()) await signInViaHub()
  const token = getAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh()
    if (refreshed || (await signInViaHub())) return requestBlob(path, false)
  }

  if (!res.ok) {
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // response wasn't JSON — leave json null
    }
    throw new ApiError((json as { message?: string })?.message ?? 'Request failed', res.status, json)
  }
  return res.blob()
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  getBlob: (path: string) => requestBlob(path),
}
