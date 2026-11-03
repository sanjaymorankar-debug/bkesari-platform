'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getAccessToken, setAccessToken, ApiError, API_BASE } from './api-client'

export interface AuthUser {
  id: string
  roles: string[]
  memberId: string | null
}

export interface SessionResult {
  accessToken: string
  user: AuthUser
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  /** Email or mobile + password. */
  login: (identifier: string, password: string) => Promise<void>
  /** Mobile + the 6-digit code from POST /auth/otp/send (or from sign-up). */
  loginWithOtp: (mobile: string, otp: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: AuthUser | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)
const USER_KEY = 'authUser'

function readStoredUser(): AuthUser | null {
  try {
    const stored = window.localStorage.getItem(USER_KEY)
    return stored ? (JSON.parse(stored) as AuthUser) : null
  } catch {
    return null
  }
}

function storeUser(user: AuthUser | null) {
  try {
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user))
    else window.localStorage.removeItem(USER_KEY)
  } catch {
    // storage blocked: the session still works for this page
  }
}

/**
 * LadWani's own sign-in. The session lives in the lw_sid cookie (HttpOnly,
 * Path=/ladwani); the 15-minute access token is kept for API calls.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const setUser = useCallback((next: AuthUser | null) => {
    storeUser(next)
    setUserState(next)
  }, [])

  const adopt = useCallback(
    (result: SessionResult) => {
      setAccessToken(result.accessToken)
      setUser(result.user)
    },
    [setUser],
  )

  const forget = useCallback(() => {
    setAccessToken(null)
    setUser(null)
  }, [setUser])

  useEffect(() => {
    let cancelled = false
    async function restore() {
      try {
        // Ask first whether the lw_sid cookie holds a session, without rotating
        // it. A visitor with none is told so (200, user null) and nothing else
        // is called; the shell may also have signed out since (its menu posts
        // /auth/logout).
        const stored = readStoredUser()
        const res = await fetch(`${API_BASE}/auth/session`, { credentials: 'include', headers: { Accept: 'application/json' } })
        if (cancelled) return
        if (!res.ok) {
          if (stored) setUserState(stored) // a 5xx or network trouble is not a sign-out
          return
        }
        const body = (await res.json().catch(() => null)) as { user?: unknown } | null
        if (cancelled) return
        if (!body || !body.user) { forget(); return }
        if (getAccessToken() && stored) { setUserState(stored); return }
        const result = await api.post<SessionResult>('/auth/refresh')
        if (!cancelled) adopt(result)
      } catch (err) {
        if (!cancelled && (!(err instanceof ApiError) || err.status === 401 || err.status === 403)) forget()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    restore()
    return () => {
      cancelled = true
    }
  }, [adopt, forget])

  const login = useCallback(
    async (identifier: string, password: string) => adopt(await api.post<SessionResult>('/auth/login', { identifier, password })),
    [adopt],
  )

  const loginWithOtp = useCallback(
    async (mobile: string, otp: string) => adopt(await api.post<SessionResult>('/auth/otp/login', { mobile, otp })),
    [adopt],
  )

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {})
    } catch {
      // ignore — clearing local state regardless
    }
    forget()
  }, [forget])

  return <AuthContext.Provider value={{ user, loading, login, loginWithOtp, logout, setUser }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string | string[] } | null
    if (Array.isArray(body?.message)) return body!.message.join(', ')
    return body?.message ?? err.message
  }
  return err instanceof Error ? err.message : 'Something went wrong'
}
