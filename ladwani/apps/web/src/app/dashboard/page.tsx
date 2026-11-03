'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../lib/api-client'
import { errorMessage, useAuth } from '../../lib/auth-context'
import { useT } from '../../lib/i18n'
import { loadProgress } from '../../lib/sign-up-progress'
import { Icon } from '../../components/icons'
import { EmptyState, ErrorState, ListSkeleton, NAV_ITEMS, RequireAuth, Shell, StatusPill, TopBar, useSignOut } from '../../components/ui'

interface MyFamily {
  familyId: string
  familyName: string
  registrationNumber: string
  status: string
  verificationStatus: string
  isKarta: boolean
}

type IdProofState = 'NOT_SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'NEEDS_ATTENTION'

export default function DashboardPage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <Dashboard />
      </Shell>
    </RequireAuth>
  )
}

function Dashboard() {
  const t = useT()
  const { user } = useAuth()
  const signOut = useSignOut()
  const [families, setFamilies] = useState<MyFamily[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idProof, setIdProof] = useState<IdProofState | null>(null)

  const load = useCallback(() => {
    setError(null)
    setFamilies(null)
    api
      .get<MyFamily[]>('/families/mine')
      .then(setFamilies)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  useEffect(() => {
    load()
    api
      .get<{ idProof: { state: IdProofState } }>('/auth/sign-up/status')
      // Members from before ID checks began are not nagged; someone part-way through sign-up is.
      .then((s) => setIdProof(s.idProof.state === 'NOT_SUBMITTED' && !loadProgress() ? null : s.idProof.state))
      .catch(() => undefined)
  }, [load])

  const more = NAV_ITEMS.filter((item) => item.href !== '/dashboard' && (!item.show || (user && item.show(user.roles))))

  return (
    <>
      <h1>{t('dashboard.title')}</h1>

      {idProof && idProof !== 'VERIFIED' && (
        <div className="k-banner k-banner--warning" role="status">
          <p>
            {idProof === 'UNDER_REVIEW' ? t('dashboard.idUnderReview') : idProof === 'NEEDS_ATTENTION' ? t('dashboard.idAttention') : t('dashboard.idMissing')}{' '}
            <Link href="/pending">{t('dashboard.idLink')}</Link>
          </p>
        </div>
      )}

      <section aria-labelledby="lw-my-families">
        <h2 id="lw-my-families" className="lw-h3">
          {t('dashboard.families')}
        </h2>
        {error && <ErrorState message={error} onRetry={load} />}
        {families === null && !error && <ListSkeleton rows={2} />}
        {families && families.length === 0 && (
          <EmptyState
            title={t('dashboard.noFamilyTitle')}
            text={t('dashboard.noFamilyText')}
            action={
              <Link href="/family/setup" className="k-btn">
                {t('dashboard.setUpFamily')}
              </Link>
            }
          />
        )}
        {families && families.length > 0 && (
          <ul className="lw-plain-list k-stack">
            {families.map((f) => (
              <li key={f.familyId}>
                <Link href={`/family/${f.familyId}`} className="k-card k-card--link">
                  <span className="lw-family-card">
                    <span>
                      <strong className="lw-card-title">{f.familyName}</strong>
                      <span className="k-muted k-small">
                        <span className="lw-mono">{f.registrationNumber}</span>
                        {f.isKarta && ` · ${t('dashboard.youAreKarta')}`}
                      </span>
                    </span>
                    <StatusPill status={f.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="k-section" aria-labelledby="lw-everything">
        <h2 id="lw-everything" className="lw-h3">
          {t('dashboard.everything')}
        </h2>
        <ul className="lw-plain-list lw-quick">
          {more.map((item) => (
            <li key={item.href}>
              <Link href={item.href === '/family' ? (families?.[0] ? `/family/${families[0].familyId}` : '/family/setup') : item.href} className="k-card k-card--link lw-quick__item">
                <span className="k-tile__icon">
                  <Icon name={item.icon} />
                </span>
                <span>{t(item.label)}</span>
              </Link>
            </li>
          ))}
          <li>
            <button type="button" className="k-card k-card--link lw-quick__item" onClick={signOut}>
              <span className="k-tile__icon">
                <Icon name="signOut" />
              </span>
              <span>{t('nav.signOut')}</span>
            </button>
          </li>
        </ul>
      </section>
    </>
  )
}
