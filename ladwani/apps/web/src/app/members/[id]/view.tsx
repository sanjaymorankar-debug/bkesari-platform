'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useRouteParams } from '@/lib/route-params'
import Link from 'next/link'
import { api } from '../../../lib/api-client'
import { errorText } from '../../../lib/errors'
import { useAuth } from '../../../lib/auth-context'
import { useT } from '../../../lib/i18n'
import { formatDate } from '../../../lib/kesari'
import { MARITAL_STATUSES, genderLabel, maritalLabel, personName } from '../../../lib/labels'
import { RequireAuth, TopBar, Shell, ErrorState, StatusPill, Avatar, Modal, PageHeader } from '../../../components/ui'
import { KIcon, type KIconName } from '../../../components/kicon'

interface MemberDetail {
  id: string
  firstName: string
  lastName: string | null
  gender: string
  status: string
  maritalStatus?: string
  currentCity?: string
  currentState?: string
  nativeVillage?: string
  dateOfBirth?: string | null
  education?: string
  occupation?: string
  employerOrBusiness?: string
  bio?: string
  skills?: { id: string; label: string }[]
}

export default function MemberProfilePage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <MemberProfile />
      </Shell>
    </RequireAuth>
  )
}

function Fact({ icon, label, children }: { icon?: KIconName; label: string; children: ReactNode }) {
  return (
    <div>
      <dt>
        {icon && <KIcon name={icon} small />}
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

/** A member's profile: who they are, what they share, and the changes an operator checks (marital status, a death). */
function MemberProfile() {
  const t = useT()
  const { id } = useRouteParams<{ id: string }>('/members/[id]')
  const { user } = useAuth()
  const [member, setMember] = useState<MemberDetail | null>(null)
  // The raw failure: put in words when shown, so it follows the language.
  const [error, setError] = useState<unknown>(null)
  const [sent, setSent] = useState(false)
  const [dialog, setDialog] = useState<'marital' | 'death' | null>(null)

  const load = useCallback(() => {
    setError(null)
    setMember(null)
    api
      .get<MemberDetail>(`/members/${id}`)
      .then(setMember)
      .catch((err) => setError(err ?? new Error()))
  }, [id])
  useEffect(load, [load])

  if (error != null) return <ErrorState message={errorText(error, t)} onRetry={load} />
  if (!member) return <ProfileSkeleton />

  const name = personName(member)
  const isSelf = user?.memberId === member.id
  const roles = user?.roles ?? []
  const deceased = member.status === 'DECEASED'
  // The API decides; these only hide what it would refuse (members.service assertCanActOnMember).
  const canChangeMarital = !deceased && (isSelf || roles.includes('KARTA') || roles.includes('ADMIN'))
  const canRecordDeath = !deceased && !isSelf && (roles.includes('KARTA') || roles.includes('ADMIN') || roles.includes('OPERATOR'))
  const lives = [member.currentCity, member.currentState].filter(Boolean).join(', ')
  const work = [member.occupation, member.employerOrBusiness].filter(Boolean).join(' · ')
  const hasDetails = Boolean(lives || member.nativeVillage || member.dateOfBirth || member.education || work || member.skills?.length)

  return (
    <>
      <div className="lw-profile-head">
        <Avatar name={name} deceased={deceased} />
        <PageHeader
          title={
            <>
              <span className={deceased ? 'lw-expired' : undefined}>{name}</span>
              {deceased && <span className="k-sr-only"> ({t('tree.deceased')})</span>}
            </>
          }
          meta={
            <>
              <StatusPill status={member.status} />
              {member.maritalStatus && <span className="k-chip k-chip--plain">{maritalLabel(t, member.maritalStatus)}</span>}
              {isSelf && <span className="k-chip k-chip--accent k-chip--plain">{t('profile.you')}</span>}
            </>
          }
          lead={lives ? t('profile.livesIn', { place: lives }) : undefined}
          actions={
            isSelf ? (
              <Link href="/profile/edit" className="k-btn">
                {t('profile.edit')}
              </Link>
            ) : undefined
          }
        />
      </div>

      {sent && (
        <div className="k-banner k-banner--success" role="status">
          <KIcon name="check" />
          <p>{t('profile.sentForReview')}</p>
        </div>
      )}

      <div className="lw-profile-grid">
        <section className="k-card" aria-labelledby="lw-profile-details">
          <h2 id="lw-profile-details" className="lw-h3">
            {t('profile.detailsTitle')}
          </h2>
          {hasDetails ? (
            <dl className="lw-facts">
              {lives && (
                <Fact icon="map-pin" label={t('profile.lives')}>
                  {lives}
                </Fact>
              )}
              {member.nativeVillage && (
                <Fact icon="home" label={t('profile.nativePlace')}>
                  {member.nativeVillage}
                </Fact>
              )}
              {member.dateOfBirth && (
                <Fact icon="calendar" label={t('field.dateOfBirth')}>
                  {formatDate(member.dateOfBirth)}
                </Fact>
              )}
              {genderLabel(t, member.gender) && member.gender !== 'NOT_STATED' && <Fact label={t('field.gender')}>{genderLabel(t, member.gender)}</Fact>}
              {member.education && (
                <Fact icon="school" label={t('field.education')}>
                  {member.education}
                </Fact>
              )}
              {work && (
                <Fact icon="book" label={t('profile.work')}>
                  {work}
                </Fact>
              )}
              {!!member.skills?.length && (
                <Fact label={t('profile.skills')}>
                  <ul className="lw-chips">
                    {member.skills.map((s) => (
                      <li key={s.id} className="k-chip k-chip--plain">
                        {s.label}
                      </li>
                    ))}
                  </ul>
                </Fact>
              )}
            </dl>
          ) : (
            <p className="k-muted">{isSelf ? t('profile.emptySelf') : t('profile.private', { name: member.firstName })}</p>
          )}
          {isSelf && !hasDetails && (
            <Link href="/profile/edit" className="k-link-arrow">
              {t('profile.addDetails')}
              <KIcon name="arrow-right" />
            </Link>
          )}
        </section>

        {member.bio && (
          <section className="k-card" aria-labelledby="lw-profile-about">
            <h2 id="lw-profile-about" className="lw-h3">
              {t('profile.about')}
            </h2>
            <p className="lw-bio">{member.bio}</p>
          </section>
        )}

        {(canChangeMarital || canRecordDeath) && (
          <section className="k-card lw-profile-changes" aria-labelledby="lw-profile-changes">
            <h2 id="lw-profile-changes" className="lw-h3">
              {t('profile.changesTitle')}
            </h2>
            <p className="k-muted">{t('profile.changesLead')}</p>
            <div className="k-row">
              {canChangeMarital && (
                <button type="button" className="k-btn k-btn--secondary" onClick={() => setDialog('marital')}>
                  {t('profile.updateMarital')}
                </button>
              )}
              {canRecordDeath && (
                <button type="button" className="k-btn k-btn--ghost" onClick={() => setDialog('death')}>
                  {t('profile.recordDeath')}
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      <MaritalDialog
        open={dialog === 'marital'}
        member={member}
        onClose={() => setDialog(null)}
        onSent={() => {
          setDialog(null)
          setSent(true)
        }}
      />
      <DeathDialog
        open={dialog === 'death'}
        member={member}
        onClose={() => setDialog(null)}
        onSent={() => {
          setDialog(null)
          setSent(true)
        }}
      />
    </>
  )
}

function ProfileSkeleton() {
  const t = useT()
  return (
    <div aria-busy="true" role="status">
      <span className="k-sr-only">{t('common.loading')}</span>
      <div className="lw-profile-head" aria-hidden="true">
        <span className="k-skel lw-rows-skel__avatar lw-profile-head__skel-avatar" />
        <span className="lw-rows-skel__lines">
          <span className="k-skel lw-skel-title" />
          <span className="k-skel k-skel--line lw-rows-skel__short" />
        </span>
      </div>
      <span className="k-skel k-skel--card" aria-hidden="true" />
    </div>
  )
}

interface DialogProps {
  open: boolean
  member: MemberDetail
  onClose: () => void
  onSent: () => void
}

/** Marital status: sent to an operator, who approves it before it shows. */
function MaritalDialog({ open, member, onClose, onSent }: DialogProps) {
  const t = useT()
  // What usually changes: unmarried to married; otherwise start from what is recorded.
  const [status, setStatus] = useState(!member.maritalStatus || member.maritalStatus === 'UNMARRIED' ? 'MARRIED' : member.maritalStatus)
  const [spouseMode, setSpouseMode] = useState<'NON_COMMUNITY' | 'EXISTING_MEMBER'>('NON_COMMUNITY')
  const [spouseName, setSpouseName] = useState('')
  const [spouseId, setSpouseId] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const married = status === 'MARRIED'
    const value = spouseMode === 'EXISTING_MEMBER' ? spouseId.trim() : spouseName.trim()
    if (married && !value) {
      setFieldError(t('validation.required'))
      return
    }
    setFieldError(null)
    setBusy(true)
    try {
      await api.patch(`/members/${member.id}/marital-status`, {
        status,
        ...(married ? (spouseMode === 'EXISTING_MEMBER' ? { spouseMode, spouseMemberId: value } : { spouseMode, externalSpouseName: value }) : {}),
      })
      onSent()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('profile.updateMarital')}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="k-btn k-btn--secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="k-btn" aria-busy={busy || undefined} disabled={busy}>
            {t('profile.sendForReview')}
          </button>
        </>
      }
    >
      <p className="k-muted">{t('profile.maritalLead', { name: member.firstName })}</p>
      {error && (
        <div className="k-banner k-banner--danger" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="k-field">
        <label className="k-label" htmlFor="lw-marital-status">
          {t('profile.maritalStatus')}
        </label>
        <select id="lw-marital-status" className="k-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {MARITAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {maritalLabel(t, s)}
            </option>
          ))}
        </select>
      </div>
      {status === 'MARRIED' && (
        <>
          <fieldset className="k-field lw-fieldset">
            <legend className="k-label">{t('profile.spouse')}</legend>
            <div className="lw-choices">
              <label className="k-check">
                <input type="radio" name="lw-spouse-mode" checked={spouseMode === 'NON_COMMUNITY'} onChange={() => setSpouseMode('NON_COMMUNITY')} />
                <span>{t('profile.spouseNotHere')}</span>
              </label>
              <label className="k-check">
                <input type="radio" name="lw-spouse-mode" checked={spouseMode === 'EXISTING_MEMBER'} onChange={() => setSpouseMode('EXISTING_MEMBER')} />
                <span>{t('profile.spouseHere')}</span>
              </label>
            </div>
          </fieldset>
          {spouseMode === 'NON_COMMUNITY' ? (
            <div className="k-field">
              <label className="k-label" htmlFor="lw-spouse-name">
                {t('profile.spouseName')}
              </label>
              <input
                id="lw-spouse-name"
                className="k-input"
                value={spouseName}
                onChange={(e) => setSpouseName(e.target.value)}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby="lw-spouse-error"
                autoComplete="off"
              />
              <span className="k-error" id="lw-spouse-error" role={fieldError ? 'alert' : undefined}>
                {fieldError ?? ''}
              </span>
            </div>
          ) : (
            <div className="k-field">
              <label className="k-label" htmlFor="lw-spouse-id">
                {t('profile.spouseId')}
              </label>
              <span className="k-hint" id="lw-spouse-id-hint">
                {t('profile.spouseIdHint')}
              </span>
              <input
                id="lw-spouse-id"
                className="k-input"
                value={spouseId}
                onChange={(e) => setSpouseId(e.target.value)}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby="lw-spouse-id-hint lw-spouse-error"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="k-error" id="lw-spouse-error" role={fieldError ? 'alert' : undefined}>
                {fieldError ?? ''}
              </span>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

/** A death: quiet, never red (docs/20 §7); an operator approves it before the profile and tree change. */
function DeathDialog({ open, member, onClose, onSent }: DialogProps) {
  const t = useT()
  const [date, setDate] = useState('')
  const [place, setPlace] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!date) {
      setFieldError(t('validation.required'))
      return
    }
    setFieldError(null)
    setBusy(true)
    try {
      await api.patch(`/members/${member.id}/deceased`, { deceasedAt: date, deceasedPlace: place.trim() || undefined })
      onSent()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('profile.recordDeath')}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="k-btn k-btn--secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="k-btn" aria-busy={busy || undefined} disabled={busy}>
            {t('profile.sendForReview')}
          </button>
        </>
      }
    >
      <p>{t('profile.deathLead', { name: personName(member) })}</p>
      {error && (
        <div className="k-banner k-banner--danger" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="k-field">
        <label className="k-label" htmlFor="lw-death-date">
          {t('profile.deathDate')}
        </label>
        <input
          id="lw-death-date"
          className="k-input"
          type="date"
          max={new Date().toISOString().slice(0, 10)}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby="lw-death-date-error"
        />
        <span className="k-error" id="lw-death-date-error" role={fieldError ? 'alert' : undefined}>
          {fieldError ?? ''}
        </span>
      </div>
      <div className="k-field">
        <label className="k-label" htmlFor="lw-death-place">
          {t('profile.deathPlace')} <span className="k-hint">({t('common.optional')})</span>
        </label>
        <input id="lw-death-place" className="k-input" value={place} onChange={(e) => setPlace(e.target.value)} />
      </div>
    </Modal>
  )
}
