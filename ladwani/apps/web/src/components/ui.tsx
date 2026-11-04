'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth, type AuthUser } from '../lib/auth-context'
import { api, BASE_PATH } from '../lib/api-client'
import { hasMessage, useT, type MessageKey } from '../lib/i18n'
import { Icon, type IconName } from './icons'

/** The page's main column. Inside RequireAuth it sits beside the side nav (k-layout). */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="k-main lw-main">
      {children}
    </main>
  )
}

interface NavItem {
  href: string
  label: MessageKey
  icon: IconName
  /** Paths that light this item besides its own. */
  also?: string[]
  show?: (roles: string[]) => boolean
}

const isAdmin = (roles: string[]) => roles.includes('ADMIN')
const isStaff = (roles: string[]) => roles.includes('ADMIN') || roles.includes('OPERATOR')

/** Everything a signed-in person can open. The dashboard lists the same, for phones. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'nav.home', icon: 'home' },
  { href: '/family', label: 'nav.family', icon: 'family' },
  { href: '/members/search', label: 'nav.search', icon: 'search', also: ['/members'] },
  { href: '/profile/edit', label: 'nav.profile', icon: 'profile', also: ['/profile', '/pending'] },
  { href: '/community', label: 'nav.feed', icon: 'feed' },
  { href: '/matrimony', label: 'nav.matrimony', icon: 'matrimony' },
  { href: '/assets', label: 'nav.services', icon: 'services' },
  { href: '/bookings', label: 'nav.bookings', icon: 'bookings' },
  { href: '/donations', label: 'nav.donations', icon: 'donations' },
  { href: '/approvals', label: 'nav.approvals', icon: 'approvals' },
  { href: '/notifications', label: 'nav.notifications', icon: 'notifications' },
  { href: '/admin/fees', label: 'nav.feeAdmin', icon: 'fees', show: isAdmin },
  { href: '/admin/payments', label: 'nav.paymentsAdmin', icon: 'payments', show: isAdmin },
  { href: '/admin/config', label: 'nav.config', icon: 'config', show: isAdmin },
  { href: '/admin/audit-log', label: 'nav.auditLog', icon: 'audit', show: isStaff },
  { href: '/admin/reports', label: 'nav.reports', icon: 'reports', show: isStaff },
]

/** Phones: four items at most (Home, Family, Search, Profile); the rest are on Home. */
const PHONE_ITEMS = NAV_ITEMS.slice(0, 4)

/** Next's path without the base path, and without a trailing slash. */
function usePath(): string {
  const path = usePathname() ?? '/'
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function isCurrent(path: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some((p) => path === p || path.startsWith(`${p}/`))
}

let myFamily: Promise<string> | null = null
/** Where "Family" goes: the person's first family, or setting one up. Asked once per page load. */
function useFamilyHref(user: AuthUser | null): string {
  const [href, setHref] = useState('/family/setup')
  useEffect(() => {
    if (!user) return
    myFamily ??= api
      .get<{ familyId: string }[]>('/families/mine')
      .then((rows) => (rows[0] ? `/family/${rows[0].familyId}` : '/family/setup'))
      .catch(() => {
        myFamily = null
        return '/family/setup'
      })
    let live = true
    myFamily.then((h) => live && setHref(h))
    return () => {
      live = false
    }
  }, [user])
  return href
}

/** Signs out of LadWani only, then reloads so the app shell's account menu follows. */
export function useSignOut() {
  const { logout } = useAuth()
  return async () => {
    myFamily = null
    await logout()
    window.location.assign(`${BASE_PATH}/sign-in/`)
  }
}

/**
 * LadWani's navigation for signed-in pages: a side nav on wide screens, a
 * bottom bar of four on phones (k-sidenav / k-bottomnav). The bkesari app
 * shell above it carries the logo, project switcher, language, theme and the
 * account menu. (Kept as TopBar: every signed-in page renders it.)
 */
export function TopBar() {
  const { user } = useAuth()
  const t = useT()
  const path = usePath()
  const familyHref = useFamilyHref(user)
  const signOut = useSignOut()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    document.body.classList.add('k-has-bottomnav')
    return () => document.body.classList.remove('k-has-bottomnav')
  }, [])

  useEffect(() => {
    if (!user) return
    api
      .get<unknown[]>('/notifications?unread=true')
      .then((rows) => setUnread(rows.length))
      .catch(() => undefined)
  }, [user])

  if (!user) return null
  const hrefOf = (item: NavItem) => (item.href === '/family' ? familyHref : item.href)
  const visible = NAV_ITEMS.filter((item) => !item.show || item.show(user.roles))

  return (
    <>
      <nav className="k-sidenav lw-sidenav" aria-label={t('nav.label')}>
        <ul>
          {visible.map((item) => (
            <li key={item.href}>
              <Link href={hrefOf(item)} aria-current={isCurrent(path, item) ? 'page' : undefined}>
                <Icon name={item.icon} />
                <span>{t(item.label)}</span>
                {item.href === '/notifications' && unread > 0 && (
                  <span className="k-badge" aria-label={t('nav.unread', { count: unread })}>
                    {unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
          <li>
            <button type="button" className="lw-sidenav__button" onClick={signOut}>
              <Icon name="signOut" />
              <span>{t('nav.signOut')}</span>
            </button>
          </li>
        </ul>
      </nav>
      <nav className="k-bottomnav" aria-label={t('nav.label')}>
        {PHONE_ITEMS.map((item) => (
          <Link key={item.href} href={hrefOf(item)} aria-current={isCurrent(path, item) ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span>{t(item.label)}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}

/** The current page, base path removed, for ?next= after signing in. */
function currentPath(): string {
  const { pathname, search } = window.location
  const path = BASE_PATH && pathname.startsWith(BASE_PATH) ? pathname.slice(BASE_PATH.length) || '/' : pathname
  return `${path}${search}`
}

/** A safe ?next= target: a path on this app, never another site. */
export function safeNext(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback
  if (/^\/(sign-in|sign-up|login|register|forgot-password|verify)(\/|$|\?)/.test(next)) return fallback
  return next
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace(`/sign-in?next=${encodeURIComponent(currentPath())}`)
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div className="k-layout">
        <main id="main" className="k-main lw-main">
          <ListSkeleton rows={4} />
        </main>
      </div>
    )
  }
  return <div className="k-layout lw-layout">{children}</div>
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="k-banner k-banner--danger" role="alert">
      <p>{message}</p>
    </div>
  )
}

/** Loading: skeleton cards, announced once to screen readers. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  const t = useT()
  return (
    <div className="lw-skeleton" aria-busy="true" role="status">
      <span className="k-sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="k-skel k-skel--card" aria-hidden="true" />
      ))}
    </div>
  )
}

/** Nothing to show yet: a short explanation and, when there is one, the next step. */
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="k-empty">
      <svg viewBox="0 0 120 96" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
        <rect x="18" y="22" width="84" height="56" rx="10" />
        <path d="M18 40h84M40 58h40" strokeLinecap="round" />
      </svg>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

/** A list that failed to load, with a way to try again. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT()
  return (
    <div className="k-banner k-banner--danger" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="k-btn k-btn--secondary k-btn--sm" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  )
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
// DECEASED is quiet, never red (docs/20 §5): it stays in the neutral chip.
const DANGER_STATUSES = new Set(['REJECTED', 'DECLINED', 'CANCELLED', 'EXPIRED', 'SUSPENDED', 'REMOVED', 'OVERDUE', 'FAILED'])

export function StatusPill({ status }: { status: string }) {
  const t = useT()
  const tone = SUCCESS_STATUSES.has(status) ? 'success' : WARNING_STATUSES.has(status) ? 'warning' : DANGER_STATUSES.has(status) ? 'danger' : 'plain'
  const key = `status.${status}`
  const words = status.replace(/_/g, ' ').toLowerCase()
  const label = hasMessage(key) ? t(key) : words.charAt(0).toUpperCase() + words.slice(1)
  return <span className={`k-chip k-chip--${tone}`}>{label}</span>
}

export function Avatar({ name, deceased }: { name: string; deceased?: boolean }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
  return (
    <span className={`k-avatar${deceased ? ' lw-avatar--deceased' : ''}`} aria-hidden="true">
      {initials || '?'}
    </span>
  )
}

/** An empty list on the older pages: one translated line in the Kesari empty state. */
export function EmptyList({ message }: { message: MessageKey }) {
  const t = useT()
  return <EmptyState title={t(message)} />
}
