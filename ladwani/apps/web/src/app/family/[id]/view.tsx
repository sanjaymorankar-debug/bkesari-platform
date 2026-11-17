'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouteParams } from '@/lib/route-params'
import { api } from '../../../lib/api-client'
import { errorText } from '../../../lib/errors'
import { useAuth } from '../../../lib/auth-context'
import { useT } from '../../../lib/i18n'
import { toast } from '../../../lib/kesari'
import { personName, relationLabel } from '../../../lib/labels'
import { RequireAuth, TopBar, Shell, ErrorBanner, ErrorState, StatusPill, Avatar, RowSkeleton, EmptyState, Modal, PageHeader } from '../../../components/ui'
import { KIcon } from '../../../components/kicon'

interface FamilyMemberRow {
  id: string
  isKarta: boolean
  firstName: string
  lastName: string | null
  status: string
}

interface FamilyDetail {
  id: string
  name: string
  registrationNumber: string
  status: string
  verificationStatus: string
  isKarta: boolean
  nativeVillage?: string | null
  nativeDistrict?: string | null
  nativeState?: string | null
  gotra?: string | null
  kuladevata?: string | null
  members: FamilyMemberRow[]
}

interface JoinRequestRow {
  id: string
  member: { firstName: string; lastName: string | null }
  relationshipTypeCode: string
}

export default function FamilyDetailPage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <Family />
      </Shell>
    </RequireAuth>
  )
}

/** A family: who is in it, the way to its tree, and (for its Karta) join requests and membership. */
function Family() {
  const t = useT()
  const { user } = useAuth()
  const { id } = useRouteParams<{ id: string }>('/family/[id]')
  const [family, setFamily] = useState<FamilyDetail | null>(null)
  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([])
  // The raw failure: put in words when shown, so it follows the language.
  const [loadError, setLoadError] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState<FamilyMemberRow | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const detail = await api.get<FamilyDetail>(`/families/${id}`)
      setFamily(detail)
      if (detail.isKarta) setJoinRequests(await api.get<JoinRequestRow[]>(`/families/${id}/join-requests`))
    } catch (err) {
      setLoadError(err ?? new Error())
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function respond(request: JoinRequestRow, decision: 'APPROVED' | 'DECLINED') {
    setError(null)
    setBusy(request.id)
    try {
      await api.post(`/join-requests/${request.id}/respond`, { decision })
      toast(t(decision === 'APPROVED' ? 'family.joinApproved' : 'family.joinDeclined', { name: personName(request.member) }), 'success')
      await load()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(null)
    }
  }

  async function removeMember() {
    if (!removing) return
    setError(null)
    setBusy(removing.id)
    try {
      await api.delete(`/families/${id}/members/${removing.id}`)
      toast(t('family.removed', { name: personName(removing) }), 'success')
      setRemoving(null)
      await load()
    } catch (err) {
      setError(errorText(err, t))
      setRemoving(null)
    } finally {
      setBusy(null)
    }
  }

  if (loadError != null && !family) return <ErrorState message={errorText(loadError, t)} onRetry={load} />
  if (!family) {
    return (
      <>
        <span className="k-skel lw-skel-title" aria-hidden="true" />
        <RowSkeleton rows={4} />
      </>
    )
  }

  const place = [family.nativeVillage, family.nativeDistrict, family.nativeState].filter(Boolean).join(', ')
  // The Karta first, then everyone else in the order the API gives.
  const members = [...family.members].sort((a, b) => Number(b.isKarta) - Number(a.isKarta))

  return (
    <>
      <PageHeader
        title={family.name}
        meta={
          <>
            <StatusPill status={family.status} />
            <StatusPill status={family.verificationStatus} />
            <span className="k-small k-muted">
              {t('family.regNo')} <span className="lw-mono">{family.registrationNumber}</span>
            </span>
          </>
        }
        lead={place ? t('family.from', { place }) : undefined}
        actions={
          family.isKarta ? (
            <>
              <Link href={`/family/${family.id}/fees`} className="k-btn k-btn--ghost">
                {t('family.fees')}
              </Link>
              <Link href={`/family/${family.id}/tree`} className="k-btn k-btn--secondary">
                <KIcon name="ladwani" />
                {t('family.viewTree')}
              </Link>
              <Link href={`/family/${family.id}/members/new`} className="k-btn">
                <KIcon name="plus" />
                {t('tree.addMember')}
              </Link>
            </>
          ) : (
            <Link href={`/family/${family.id}/tree`} className="k-btn">
              <KIcon name="ladwani" />
              {t('family.viewTree')}
            </Link>
          )
        }
      />

      {family.status === 'PENDING' && (
        <div className="k-banner k-banner--warning" role="status">
          <KIcon name="pending" />
          <p>{t('family.pendingCheck')}</p>
        </div>
      )}
      <ErrorBanner message={error} />

      {(family.gotra || family.kuladevata) && (
        <dl className="lw-inline-facts">
          {family.gotra && (
            <div>
              <dt>{t('family.gotra')}</dt>
              <dd>{family.gotra}</dd>
            </div>
          )}
          {family.kuladevata && (
            <div>
              <dt>{t('family.kuladevata')}</dt>
              <dd>{family.kuladevata}</dd>
            </div>
          )}
        </dl>
      )}

      {family.isKarta && joinRequests.length > 0 && (
        <section className="k-section lw-section-tight" aria-labelledby="lw-join-requests">
          <h2 id="lw-join-requests" className="lw-h3">
            {t('family.joinRequests')} <span className="k-badge">{joinRequests.length}</span>
          </h2>
          <p className="k-muted">{t('family.joinRequestsLead')}</p>
          <ul className="k-statuslist">
            {joinRequests.map((r) => (
              <li key={r.id} className="k-statusrow">
                <Avatar name={personName(r.member)} />
                <div>
                  <h3>{personName(r.member)}</h3>
                  <p>{t('family.relation', { relation: relationLabel(t, r.relationshipTypeCode) })}</p>
                </div>
                <div className="k-statusrow__action lw-row-actions">
                  <button type="button" className="k-btn k-btn--secondary" disabled={busy === r.id} onClick={() => respond(r, 'DECLINED')}>
                    {t('family.decline')}
                  </button>
                  <button type="button" className="k-btn k-btn--soft" aria-busy={busy === r.id || undefined} disabled={busy === r.id} onClick={() => respond(r, 'APPROVED')}>
                    {t('family.approve')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="k-section lw-section-tight" aria-labelledby="lw-family-members">
        <h2 id="lw-family-members" className="lw-h3">
          {t('family.members')} <span className="k-muted lw-count">({members.length})</span>
        </h2>
        {members.length === 0 ? (
          <EmptyState
            icon="users"
            title={t('tree.emptyTitle')}
            text={t('tree.emptyText')}
            action={
              family.isKarta ? (
                <Link href={`/family/${family.id}/members/new`} className="k-btn">
                  {t('tree.addMember')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="k-statuslist lw-members">
            {members.map((m) => {
              const name = personName(m)
              const deceased = m.status === 'DECEASED'
              return (
                <li key={m.id} className="k-statusrow lw-member-row">
                  <Avatar name={name} deceased={deceased} />
                  <div>
                    <h3>
                      <Link href={`/members/${m.id}`} className="lw-member-row__link">
                        <span className={deceased ? 'lw-expired' : undefined}>{name}</span>
                        {deceased && <span className="k-sr-only"> ({t('tree.deceased')})</span>}
                      </Link>
                    </h3>
                    <p className="k-statusrow__meta lw-member-row__meta">
                      {m.isKarta && <span className="k-chip k-chip--accent k-chip--plain">{t('tree.karta')}</span>}
                      {user?.memberId === m.id && <span className="k-chip k-chip--plain">{t('profile.you')}</span>}
                      {/* Most members are active: only another status is worth a chip. */}
                      {m.status !== 'ACTIVE' && <StatusPill status={m.status} />}
                    </p>
                  </div>
                  {family.isKarta && !m.isKarta && (
                    <div className="k-statusrow__action">
                      <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setRemoving(m)} aria-label={t('family.removeLabel', { name })}>
                        {t('family.remove')}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={removing ? t('family.removeTitle', { name: personName(removing) }) : ''}
        footer={
          <>
            <button type="button" className="k-btn k-btn--secondary" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="k-btn k-btn--danger" aria-busy={busy === removing?.id || undefined} disabled={busy === removing?.id} onClick={removeMember}>
              {t('family.removeConfirm')}
            </button>
          </>
        }
      >
        <p>{t('family.removeText')}</p>
      </Modal>
    </>
  )
}
