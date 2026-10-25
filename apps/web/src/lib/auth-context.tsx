'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getAccessToken, setAccessToken, ApiError } from './api-client'

export interface AuthUser {
  id: string
  roles: string[]
  memberId: string | null
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (identifier: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (user: AuthUser | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function restore() {
      if (!getAccessToken()) {
        // Behind bkesari.com the hub signs every forwarded request, so a visitor
        // who signed in there is signed in here too, with no second password.
        try {
          const result = await api.post<{ accessToken: string; user: AuthUser }>('/auth/hub')
          setAccessToken(result.accessToken)
          window.localStorage.setItem('authUser', JSON.stringify(result.user))
          setUser(result.user)
        } catch {
          // not behind the hub, or no access there: the normal login page applies
        }
        setLoading(false)
        return
      }
      try {
        const stored = window.localStorage.getItem('authUser')
        if (stored) setUser(JSON.parse(stored))
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    restore()
  }, [])

  async function login(identifier: string, password: string) {
    const result = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', { identifier, password })
    setAccessToken(result.accessToken)
    window.localStorage.setItem('authUser', JSON.stringify(result.user))
    setUser(result.user)
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
    } catch {
      // ignore — clearing local state regardless
    }
    setAccessToken(null)
    window.localStorage.removeItem('authUser')
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>{children}</AuthContext.Provider>
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
