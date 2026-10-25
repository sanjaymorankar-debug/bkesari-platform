'use client'

import { useEffect, useState } from 'react'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

interface AuditLogRow {
  id: string
  actorId: string
  actorRole: string | null
  action: string
  entityType: string | null
  entityId: string | null
  newValue: unknown
  ipAddress: string | null
  createdAt: string
}

const PAGE_SIZE = 50

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[] | null>(null)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [actionFilter, setActionFilter] = useState('')
  const [entityTypeFilter, setEntityTypeFilter] = useState('')

  function load() {
    const params = new URLSearchParams()
    if (actionFilter) params.set('action', actionFilter)
    if (entityTypeFilter) params.set('entityType', entityTypeFilter)
    params.set('take', String(PAGE_SIZE))
    params.set('skip', String(page * PAGE_SIZE))

    api
      .get<AuditLogRow[]>(`/audit-logs?${params.toString()}`)
      .then(setRows)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [page, actionFilter, entityTypeFilter])

  function applyFilters(e: React.FormEvent) {
    e.preventDefault()
    setPage(0)
    load()
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Audit log</h1>
        <ErrorBanner message={error} />

        <form onSubmit={applyFilters} className="row" style={{ marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field">
            <label htmlFor="action-filter">Action contains</label>
            <input id="action-filter" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder="fee.invoice.create" />
          </div>
          <div className="field">
            <label htmlFor="entity-filter">Entity type</label>
            <input id="entity-filter" value={entityTypeFilter} onChange={(e) => setEntityTypeFilter(e.target.value)} placeholder="payment" />
          </div>
          <button className="btn btn-outline" type="submit">Filter</button>
        </form>

        {rows === null && !error && <p className="muted">Loading…</p>}
        {rows?.length === 0 && <p className="muted">No matching entries.</p>}

        <div className="stack">
          {rows?.map((r) => (
            <div key={r.id} className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{r.action}</strong>
                <span className="muted mono" style={{ fontSize: 13 }}>{new Date(r.createdAt).toLocaleString()}</span>
              </div>
              <p className="muted mono" style={{ margin: 0, fontSize: 13 }}>
                actor {r.actorId} ({r.actorRole ?? 'unknown role'}) · {r.entityType ?? 'n/a'} {r.entityId ?? ''} · {r.ipAddress ?? 'no ip'}
              </p>
              {!!r.newValue && (
                <pre className="mono" style={{ background: 'var(--bg)', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}>
                  {JSON.stringify(r.newValue, null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>

        <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
          <button className="btn btn-outline" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Previous
          </button>
          <span className="muted">Page {page + 1}</span>
          <button className="btn btn-outline" disabled={!rows || rows.length < PAGE_SIZE} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </Shell>
    </RequireAuth>
  )
}
