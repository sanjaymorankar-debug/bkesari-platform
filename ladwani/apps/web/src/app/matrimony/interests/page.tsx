'use client'

import { useEffect, useState } from 'react'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../../components/ui'

interface InterestRow {
  id: string
  kind: string
  status: string
  message: string | null
  fromMember?: { firstName: string; lastName: string | null }
  toMember?: { firstName: string; lastName: string | null }
}

export default function MatrimonyInterestsPage() {
  const [tab, setTab] = useState<'received' | 'sent'>('received')
  const [received, setReceived] = useState<InterestRow[] | null>(null)
  const [sent, setSent] = useState<InterestRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    api.get<InterestRow[]>('/matrimony/interests/received').then(setReceived).catch((err) => setError(errorMessage(err)))
    api.get<InterestRow[]>('/matrimony/interests/sent').then(setSent).catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [])

  async function respond(id: string, decision: 'ACCEPTED' | 'DECLINED') {
    try {
      await api.post(`/matrimony/interests/${id}/respond`, { decision })
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const rows = tab === 'received' ? received : sent

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Matrimony interests</h1>
        <div className="row" style={{ marginBottom: 16 }}>
          <button className={tab === 'received' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setTab('received')}>
            Received
          </button>
          <button className={tab === 'sent' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setTab('sent')}>
            Sent
          </button>
        </div>

        <ErrorBanner message={error} />

        <div className="stack">
          {rows?.length === 0 && <p className="muted">Nothing here yet.</p>}
          {rows?.map((r) => {
            const person = tab === 'received' ? r.fromMember : r.toMember
            return (
              <div key={r.id} className="card row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <strong>
                    {person?.firstName} {person?.lastName ?? ''}
                  </strong>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    {r.kind === 'CONTACT_REQUEST' ? 'Contact request' : 'Interest'}
                    {r.message ? ` — "${r.message}"` : ''}
                  </p>
                </div>
                <div className="row">
                  <StatusPill status={r.status} />
                  {tab === 'received' && r.status === 'PENDING' && (
                    <>
                      <button className="btn btn-outline" onClick={() => respond(r.id, 'DECLINED')}>
                        Decline
                      </button>
                      <button className="btn btn-accent" onClick={() => respond(r.id, 'ACCEPTED')}>
                        Accept
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Shell>
    </RequireAuth>
  )
}
