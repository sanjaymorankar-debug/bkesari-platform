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
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
export const API_BASE = `${BASE_PATH}/api/v1`

let accessToken: string | null = null

/** Their 401 means "wrong code/password" or "no session", never "access token expired". */
const SIGN_IN_ROUTES = /^\/auth\/(refresh|login|logout|register|verify-otp|session|otp\/|password\/)/

export function setAccessToken(token: string | null) {
  accessToken = token
  if (typeof window === 'undefined') return
  try {
    if (token) window.localStorage.setItem('accessToken', token)
    else window.localStorage.removeItem('accessToken')
  } catch {
    // storage blocked (private window): the token lives in memory for this page
  }
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken
  if (typeof window !== 'undefined') {
    try {
      accessToken = window.localStorage.getItem('accessToken')
    } catch {
      accessToken = null
    }
  }
  return accessToken
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const json = await requestJson<{ data: T }>(method, path, body, retry)
  return json?.data as T
}

/** The whole JSON body, for the few replies that carry more than `data` (devOtp, outside production). */
async function requestJson<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
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

  if (res.status === 401 && retry && !SIGN_IN_ROUTES.test(path)) {
    const refreshed = await tryRefresh()
    if (refreshed) return requestJson<T>(method, path, body, false)
  }

  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // not JSON (a proxy's error page): reported below by status
  }

  if (!res.ok) {
    throw new ApiError(json?.message ?? 'Request failed', res.status, json)
  }
  return json as T
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
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
  const token = getAccessToken()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh()
    if (refreshed) return requestBlob(path, false)
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
  /** POST that hands back the whole reply: `{ data, devOtp? }`. */
  postFull: <T>(path: string, body?: unknown) => requestJson<{ data: T; devOtp?: string }>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  getBlob: (path: string) => requestBlob(path),
}
