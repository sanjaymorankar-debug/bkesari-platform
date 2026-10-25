'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import Link from 'next/link'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../components/ui'

interface ApprovalRow {
  id: string
  actionCode: string
  entityType: string | null
  entityId: string | null
  newValue: unknown
  status: string
  submittedAt: string
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})

  function load() {
    api
      .get<ApprovalRow[]>('/approvals')
      .then(setApprovals)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [])

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setError(null)
    try {
      await api.post(`/approvals/${id}/decide`, { decision, note: note[id] || undefined })
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>Approval queue</h1>
          <Link href="/community/moderation" className="btn btn-outline">
            Content moderation queue
          </Link>
        </div>
        <ErrorBanner message={error} />

        {approvals === null && !error && <p className="muted">Loading…</p>}
        {approvals?.length === 0 && <p className="muted">Nothing pending review.</p>}

        <div className="stack" style={{ marginTop: 16 }}>
          {approvals?.map((a) => (
            <div key={a.id} className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ marginBottom: 4 }}>{a.actionCode}</h3>
                  <p className="muted mono" style={{ margin: 0, fontSize: 13 }}>
                    Submitted {new Date(a.submittedAt).toLocaleString()}
                  </p>
                </div>
                <StatusPill status={a.status} />
              </div>
              <pre
                className="mono"
                style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}
              >
                {JSON.stringify(a.newValue, null, 2)}
              </pre>
              <input
                placeholder="Note (optional)"
                value={note[a.id] ?? ''}
                onChange={(e) => setNote({ ...note, [a.id]: e.target.value })}
              />
              <div className="row">
                <button className="btn btn-outline" onClick={() => decide(a.id, 'REJECTED')}>
                  Reject
                </button>
                <button className="btn btn-accent" onClick={() => decide(a.id, 'APPROVED')}>
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
