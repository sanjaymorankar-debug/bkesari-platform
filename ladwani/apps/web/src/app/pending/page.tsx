'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../lib/api-client'
import { errorMessage, useAuth } from '../../lib/auth-context'
import { useT } from '../../lib/i18n'
import { formatDate } from '../../lib/kesari'
import { AuthFrame } from '../../components/auth-ui'
import { ErrorState, ListSkeleton, safeNext } from '../../components/ui'
import { useRouter } from 'next/navigation'

type IdProofState = 'NOT_SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'NEEDS_ATTENTION'
interface Status {
  idProof: { state: IdProofState; submittedAt: string | null; note: string | null }
}

/**
 * "Approval pending": where the person's ID proof check stands, in plain words.
 * It says what is happening and what to do next; it never says who reviews it.
 */
export default function PendingPage() {
  const t = useT()
  const router = useRouter()
  const { user, loading } = useAuth()
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    setStatus(null)
    api
      .get<Status>('/auth/sign-up/status')
      .then(setStatus)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  useEffect(() => {
    if (loading) return
    if (!user) router.replace(`/sign-in?next=${encodeURIComponent(safeNext('/pending'))}`)
    else load()
  }, [loading, user, router, load])

  const proof = status?.idProof
  return (
    <AuthFrame title={t('pending.title')} lead={t('pending.lead')}>
      {error && <ErrorState message={error} onRetry={load} />}
      {!status && !error && <ListSkeleton rows={2} />}
      {proof && (
        <div className="lw-pending" aria-live="polite">
          {proof.state === 'UNDER_REVIEW' && (
            <>
              <p>
                <span className="k-chip k-chip--warning">{t('pending.underReview')}</span>
              </p>
              <p>{t('pending.reviewText')}</p>
              <p className="k-muted">
                {t('pending.expected')}
                {proof.submittedAt && ` ${t('pending.submittedOn', { date: formatDate(proof.submittedAt) })}`}
              </p>
              <h2 className="lw-h3">{t('pending.nextTitle')}</h2>
              <ul className="lw-next">
                <li>
                  <Link href="/family/setup">{t('pending.nextFamily')}</Link>
                </li>
                <li>
                  <Link href="/notifications">{t('pending.nextNotify')}</Link>
                </li>
                <li>
                  <Link href="/profile/edit">{t('pending.nextProfile')}</Link>
                </li>
              </ul>
            </>
          )}
          {proof.state === 'VERIFIED' && (
            <>
              <p>
                <span className="k-chip k-chip--success">{t('pending.verified')}</span>
              </p>
              <p>{t('pending.verifiedText')}</p>
              <Link href="/dashboard" className="k-btn">
                {t('pending.toHome')}
              </Link>
            </>
          )}
          {proof.state === 'NEEDS_ATTENTION' && (
            <>
              <p>
                <span className="k-chip k-chip--danger">{t('pending.attention')}</span>
              </p>
              <p>{t('pending.attentionText')}</p>
              {proof.note && <blockquote className="lw-note">{proof.note}</blockquote>}
              <Link href="/sign-up?step=4" className="k-btn">
                {t('pending.uploadAgain')}
              </Link>
            </>
          )}
          {proof.state === 'NOT_SUBMITTED' && (
            <>
              <p>{t('pending.notSubmitted')}</p>
              <Link href="/sign-up?step=4" className="k-btn">
                {t('pending.finish')}
              </Link>
            </>
          )}
        </div>
      )}
    </AuthFrame>
  )
}
