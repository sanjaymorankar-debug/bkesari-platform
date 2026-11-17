'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../lib/api-client'
import { errorText } from '../../lib/errors'
import { useAuth } from '../../lib/auth-context'
import { useT, type MessageKey } from '../../lib/i18n'
import { formatDate } from '../../lib/kesari'
import { AuthFrame } from '../../components/auth-ui'
import { ErrorState, ListSkeleton, safeNext } from '../../components/ui'
import { KIcon, type KIconName } from '../../components/kicon'
import { useRouter } from 'next/navigation'

type IdProofState = 'NOT_SUBMITTED' | 'UNDER_REVIEW' | 'VERIFIED' | 'NEEDS_ATTENTION'
interface Status {
  idProof: { state: IdProofState; submittedAt: string | null; note: string | null }
}

type StepState = 'done' | 'now' | 'todo' | 'attention' | 'next'
interface Step {
  title: MessageKey
  state: StepState
  detail?: string
}

const STATE_ICON: Record<StepState, KIconName | null> = { done: 'check', now: 'clock', todo: 'arrow-right', attention: 'alert', next: null }
const STATE_LABEL: Record<StepState, MessageKey> = {
  done: 'pending.stateDone',
  now: 'pending.stateNow',
  todo: 'pending.stateTodo',
  attention: 'pending.attention',
  next: 'pending.stateNext',
}

/** Where sign-up stands, from the ID proof's state: four steps, the operator's check among them. */
function stepsFor(proof: Status['idProof'], t: ReturnType<typeof useT>): Step[] {
  const sent = proof.submittedAt ? t('pending.submittedOn', { date: formatDate(proof.submittedAt) }) : undefined
  const id: Step =
    proof.state === 'NOT_SUBMITTED'
      ? { title: 'pending.stepId', state: 'todo' }
      : proof.state === 'NEEDS_ATTENTION'
        ? { title: 'pending.stepId', state: 'attention', detail: t('pending.attentionText') }
        : { title: 'pending.stepId', state: 'done', detail: sent }
  const check: Step =
    proof.state === 'VERIFIED'
      ? { title: 'pending.stepCheck', state: 'done' }
      : proof.state === 'UNDER_REVIEW'
        ? { title: 'pending.stepCheck', state: 'now', detail: t('pending.expected') }
        : { title: 'pending.stepCheck', state: 'next' }
  return [
    { title: 'pending.stepEmail', state: 'done' },
    id,
    check,
    { title: 'pending.stepAccess', state: proof.state === 'VERIFIED' ? 'done' : 'next' },
  ]
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
  // The raw failure: put in words when shown, so it follows the language.
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(() => {
    setError(null)
    setStatus(null)
    api
      .get<Status>('/auth/sign-up/status')
      .then(setStatus)
      .catch((err) => setError(err ?? new Error()))
  }, [])

  useEffect(() => {
    if (loading) return
    if (!user) router.replace(`/sign-in?next=${encodeURIComponent(safeNext('/pending'))}`)
    else load()
  }, [loading, user, router, load])

  const proof = status?.idProof
  return (
    <AuthFrame icon={proof?.state === 'VERIFIED' ? 'check' : 'pending'} title={t('pending.title')} lead={t('pending.lead')}>
      {error != null && <ErrorState message={errorText(error, t)} onRetry={load} />}
      {!status && error == null && <ListSkeleton rows={2} />}
      {proof && (
        <div className="lw-pending" aria-live="polite">
          <p className="lw-pending__summary">
            {proof.state === 'UNDER_REVIEW' && <span className="k-chip k-chip--warning">{t('pending.underReview')}</span>}
            {proof.state === 'VERIFIED' && <span className="k-chip k-chip--success">{t('pending.verified')}</span>}
            {proof.state === 'NEEDS_ATTENTION' && <span className="k-chip k-chip--danger">{t('pending.attention')}</span>}
            {proof.state === 'NOT_SUBMITTED' && <span className="k-chip">{t('pending.stateTodo')}</span>}
          </p>
          <p>
            {proof.state === 'UNDER_REVIEW' && t('pending.reviewText')}
            {proof.state === 'VERIFIED' && t('pending.verifiedText')}
            {proof.state === 'NEEDS_ATTENTION' && t('pending.attentionText')}
            {proof.state === 'NOT_SUBMITTED' && t('pending.notSubmitted')}
          </p>
          {proof.state === 'NEEDS_ATTENTION' && proof.note && <blockquote className="lw-note">{proof.note}</blockquote>}

          <h2 className="k-sr-only">{t('pending.stepsLabel')}</h2>
          <ol className="lw-timeline">
            {stepsFor(proof, t).map((step) => {
              const icon = STATE_ICON[step.state]
              return (
                <li key={step.title} className="lw-timeline__step" data-state={step.state}>
                  <span className="lw-timeline__dot" aria-hidden="true">
                    {icon && <KIcon name={icon} small />}
                  </span>
                  <span className="lw-timeline__text">
                    <span className="lw-timeline__title">{t(step.title)}</span>
                    <span className="lw-timeline__state">
                      {t(STATE_LABEL[step.state])}
                      {step.detail && step.state !== 'attention' ? ` · ${step.detail}` : ''}
                    </span>
                  </span>
                </li>
              )
            })}
          </ol>

          {proof.state === 'UNDER_REVIEW' && (
            <>
              <h2 className="lw-h3">{t('pending.nextTitle')}</h2>
              <p>{t('pending.nextFamily')}</p>
              <Link href="/family/setup" className="k-btn k-btn--block">
                {t('dashboard.setUpFamily')}
              </Link>
              <ul className="lw-links">
                <li>
                  <Link href="/notifications" className="k-link-arrow">
                    {t('pending.nextNotify')}
                    <KIcon name="arrow-right" />
                  </Link>
                </li>
                <li>
                  <Link href="/profile/edit" className="k-link-arrow">
                    {t('pending.nextProfile')}
                    <KIcon name="arrow-right" />
                  </Link>
                </li>
              </ul>
            </>
          )}
          {proof.state === 'VERIFIED' && (
            <Link href="/dashboard" className="k-btn k-btn--block">
              {t('pending.toHome')}
            </Link>
          )}
          {proof.state === 'NEEDS_ATTENTION' && (
            <Link href="/sign-up?step=4" className="k-btn k-btn--block">
              {t('pending.uploadAgain')}
            </Link>
          )}
          {proof.state === 'NOT_SUBMITTED' && (
            <Link href="/sign-up?step=4" className="k-btn k-btn--block">
              {t('pending.finish')}
            </Link>
          )}
        </div>
      )}
    </AuthFrame>
  )
}
