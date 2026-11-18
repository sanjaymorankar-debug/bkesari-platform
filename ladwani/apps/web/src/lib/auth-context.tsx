'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getAccessToken, setAccessToken, ApiError, API_BASE } from './api-client'
import { loadProgress, saveProgress } from './sign-up-progress'

export interface AuthUser {
  id: string
  roles: string[]
  memberId: string | null
}

export interface SessionResult {
  accessToken: string
  user: AuthUser
}

/** POST /auth/hub's answer: a session as /auth/login gives, and whether the LadWani account was made just now. */
interface HubSessionResult extends SessionResult {
  created?: boolean
}

/** Where a one-time code went: an email address (the default while SMS is on hold) or a mobile number. */
export type CodeTarget = { email: string } | { mobile: string }

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  /**
   * Whether the API has an SMS provider (GET /auth/session, smsLive). None
   * today: SMS is on hold, so the screens offer codes by email only.
   */
  smsLive: boolean
  /** Email or mobile + password. */
  login: (identifier: string, password: string) => Promise<void>
  /** The 6-digit code from POST /auth/otp/send (or from sign-up), with the email (or mobile) it went to. */
  loginWithOtp: (target: CodeTarget, otp: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: AuthUser | null) => void
  /**
   * Why the bkesari hub's sign-in (POST /auth/hub) refused the person on this
   * load (403 or 409: a suspended account, or an email LadWani cannot join to
   * their bkesari ID yet), for the sign-in page to show. Null otherwise.
   */
  hubNotice: string | null
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
 * Tells the bkesari app shell that LadWani has signed someone in or out. The
 * shell's account menu asked who is signed in when the page loaded, which on a
 * first visit is before POST /auth/hub has made the LadWani session; it asks
 * again when this no longer matches what it shows (portal/public/shared/menu.js).
 */
function tellShell(signedIn: boolean) {
  try {
    window.dispatchEvent(new CustomEvent('bkesari:account', { detail: { signedIn } }))
  } catch {
    // no CustomEvent: the menu catches up at the next page
  }
}

/**
 * LadWani's sign-in. The session lives in the lw_sid cookie (HttpOnly,
 * Path=/ladwani); the 15-minute access token is kept for API calls.
 *
 * On every load it first asks POST /auth/hub: inside bkesari.com the hub has
 * already signed the person in, and its signed identity on that request
 * becomes their LadWani session (ending anyone else's in this browser). The
 * answer is { data: null } where there is no such identity (LadWani on its
 * own, or the hub's secret not set here); then LadWani's own session cookie
 * and sign-in page work as before.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [smsLive, setSmsLive] = useState(false)
  const [hubNotice, setHubNotice] = useState<string | null>(null)

  const setUser = useCallback((next: AuthUser | null) => {
    storeUser(next)
    setUserState(next)
    tellShell(next !== null)
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
        let viaHub: HubSessionResult | null = null
        try {
          viaHub = await api.post<HubSessionResult | null>('/auth/hub', {})
        } catch (err) {
          // Refused (suspended, or an email LadWani cannot join yet): the API has
          // ended any session this browser held; say why on the sign-in page.
          // Anything else (network trouble, an older API) goes on as before.
          if (err instanceof ApiError && (err.status === 403 || err.status === 409) && !cancelled) setHubNotice(errorMessage(err))
        }
        if (cancelled) return
        if (viaHub) {
          adopt(viaHub)
          // A LadWani account made just now: the rest of sign-up (profile, place,
          // ID proof) is what LadWani's operators verify, so the dashboard asks
          // for it and /sign-up carries on from step 2.
          if (viaHub.created && !loadProgress()) saveProgress({ step: 2 })
          return
        }

        // Ask whether the lw_sid cookie holds a session, without rotating
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
        const body = (await res.json().catch(() => null)) as { user?: unknown; smsLive?: unknown } | null
        if (cancelled) return
        setSmsLive(body?.smsLive === true)
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
    async (target: CodeTarget, otp: string) => adopt(await api.post<SessionResult>('/auth/otp/login', { ...target, otp })),
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

  return <AuthContext.Provider value={{ user, loading, smsLive, login, loginWithOtp, logout, setUser, hubNotice }}>{children}</AuthContext.Provider>
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
