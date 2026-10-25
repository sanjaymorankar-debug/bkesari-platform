'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill, Avatar } from '../../../components/ui'

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
  members: FamilyMemberRow[]
}

interface JoinRequestRow {
  id: string
  member: { firstName: string; lastName: string | null }
  relationshipTypeCode: string
}

export default function FamilyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [family, setFamily] = useState<FamilyDetail | null>(null)
  const [joinRequests, setJoinRequests] = useState<JoinRequestRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const detail = await api.get<FamilyDetail>(`/families/${id}`)
      setFamily(detail)
      if (detail.isKarta) {
        const requests = await api.get<JoinRequestRow[]>(`/families/${id}/join-requests`)
        setJoinRequests(requests)
      }
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function respond(requestId: string, decision: 'APPROVED' | 'DECLINED') {
    try {
      await api.post(`/join-requests/${requestId}/respond`, { decision })
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm('Remove this member from the family? Their profile is kept, only their membership ends.')) return
    try {
      await api.delete(`/families/${id}/members/${memberId}`)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  if (!family && !error) {
    return (
      <RequireAuth>
        <TopBar />
        <Shell>Loading…</Shell>
      </RequireAuth>
    )
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <ErrorBanner message={error} />
        {family && (
          <>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1>{family.name}</h1>
                <p className="muted mono">{family.registrationNumber}</p>
              </div>
              <div className="row">
                <StatusPill status={family.status} />
                <StatusPill status={family.verificationStatus} />
              </div>
            </div>

            <div className="row" style={{ marginBottom: 20 }}>
              <Link href={`/family/${family.id}/tree`} className="btn btn-outline">
                View family tree
              </Link>
              {family.isKarta && (
                <Link href={`/family/${family.id}/members/new`} className="btn btn-accent">
                  Add a member
                </Link>
              )}
              {family.isKarta && (
                <Link href={`/family/${family.id}/fees`} className="btn btn-outline">
                  Fee invoices
                </Link>
              )}
            </div>

            {family.isKarta && joinRequests.length > 0 && (
              <div className="card stack" style={{ marginBottom: 20 }}>
                <h3>Pending join requests</h3>
                {joinRequests.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      {r.member.firstName} {r.member.lastName ?? ''} — relation: {r.relationshipTypeCode}
                    </span>
                    <div className="row">
                      <button className="btn btn-outline" onClick={() => respond(r.id, 'DECLINED')}>
                        Decline
                      </button>
                      <button className="btn btn-accent" onClick={() => respond(r.id, 'APPROVED')}>
                        Approve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3>Members</h3>
            <div className="stack">
              {family.members.map((m) => (
                <div key={m.id} className="card row" style={{ justifyContent: 'space-between' }}>
                  <div className="row">
                    <Avatar name={`${m.firstName} ${m.lastName ?? ''}`} deceased={m.status === 'DECEASED'} />
                    <div>
                      <Link href={`/members/${m.id}`} style={{ fontWeight: 600, textDecoration: 'none', color: 'inherit' }}>
                        {m.firstName} {m.lastName ?? ''}
                      </Link>
                      {m.isKarta && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Karta</p>}
                    </div>
                  </div>
                  <div className="row">
                    <StatusPill status={m.status} />
                    {family.isKarta && !m.isKarta && (
                      <button className="btn btn-danger" onClick={() => removeMember(m.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Shell>
    </RequireAuth>
  )
}
