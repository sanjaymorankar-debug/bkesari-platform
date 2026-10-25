'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../lib/auth-context'
import { api } from '../lib/api-client'

export function Shell({ children }: { children: ReactNode }) {
  return <div className="shell">{children}</div>
}

export function TopBar() {
  const { user, logout } = useAuth()
  const router = useRouter()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!user) return
    api
      .get<unknown[]>('/notifications?unread=true')
      .then((rows) => setUnreadCount(rows.length))
      .catch(() => undefined)
  }, [user])

  async function handleLogout() {
    await logout()
    router.push('/login')
  }

  return (
    <div className="topbar">
      <Link href="/dashboard" style={{ fontFamily: 'var(--font-display), serif', fontSize: 20, fontWeight: 600, textDecoration: 'none', color: 'var(--ink)' }}>
        Mi Samaj
      </Link>
      {user && (
        <nav>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/community">Feed</Link>
          <Link href="/matrimony">Matrimony</Link>
          <Link href="/assets">Services</Link>
          <Link href="/bookings">My Bookings</Link>
          <Link href="/members/search">Directory</Link>
          <Link href="/donations">Donations</Link>
          <Link href="/approvals">Approvals</Link>
          {user.roles.includes('ADMIN') && <Link href="/admin/fees">Fee admin</Link>}
          {user.roles.includes('ADMIN') && <Link href="/admin/payments">Payments admin</Link>}
          {user.roles.includes('ADMIN') && <Link href="/admin/config">Configuration</Link>}
          {(user.roles.includes('ADMIN') || user.roles.includes('OPERATOR')) && <Link href="/admin/audit-log">Audit log</Link>}
          {(user.roles.includes('ADMIN') || user.roles.includes('OPERATOR')) && <Link href="/admin/reports">Reports</Link>}
          <Link href="/notifications" style={{ position: 'relative' }}>
            Notifications
            {unreadCount > 0 && (
              <span
                className="pill pill-danger"
                style={{ position: 'absolute', top: -10, right: -18, padding: '0 6px', fontSize: 10, lineHeight: '16px' }}
              >
                {unreadCount}
              </span>
            )}
          </Link>
          <button className="btn btn-outline" onClick={handleLogout} style={{ padding: '4px 12px' }}>
            Log out
          </button>
        </nav>
      )}
    </div>
  )
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  if (loading) return <Shell>Loading…</Shell>
  if (!user) {
    if (typeof window !== 'undefined') router.replace('/login')
    return null
  }
  return <>{children}</>
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="error-banner">{message}</div>
}

const SUCCESS_STATUSES = new Set(['ACTIVE', 'VERIFIED', 'APPROVED', 'MARRIED', 'CONFIRMED', 'COMPLETED', 'AVAILABLE', 'PAID', 'SUCCESSFUL'])
const WARNING_STATUSES = new Set([
  'PENDING',
  'SUBMITTED',
  'UNDER_REVIEW',
  'REQUESTED',
  'PENDING_VERIFICATION',
  'PENDING_APPROVAL',
  'RESERVED',
  'PARTIAL',
  'UNPAID',
  'PROCESSING',
  'INITIATED',
  'CREATED',
  'UNDER_VERIFICATION',
  'PARTIALLY_REFUNDED',
])
const DANGER_STATUSES = new Set(['REJECTED', 'DECEASED', 'DECLINED', 'INACTIVE', 'CANCELLED', 'EXPIRED', 'SUSPENDED', 'REMOVED', 'OVERDUE', 'FAILED'])

export function StatusPill({ status }: { status: string }) {
  const tone = SUCCESS_STATUSES.has(status) ? 'success' : WARNING_STATUSES.has(status) ? 'warning' : DANGER_STATUSES.has(status) ? 'danger' : 'neutral'
  return <span className={`pill pill-${tone}`}>{status.replace(/_/g, ' ')}</span>
}

export function Avatar({ name, deceased }: { name: string; deceased?: boolean }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return <div className={`avatar${deceased ? ' deceased' : ''}`}>{initials || '?'}</div>
}
