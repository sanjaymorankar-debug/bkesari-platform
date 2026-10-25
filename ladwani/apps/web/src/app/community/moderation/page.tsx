'use client'

import { useEffect, useState } from 'react'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

interface PendingPost {
  id: string
  title: string | null
  content: string
  author: { firstName: string; lastName: string | null }
  postType: { label: string }
}

interface PendingReport {
  id: string
  reason: string
  post?: { id: string; content: string } | null
  comment?: { id: string; content: string } | null
  reportedMember?: { firstName: string; lastName: string | null } | null
  reporter: { firstName: string; lastName: string | null }
}

export default function ModerationQueuePage() {
  const [pendingPosts, setPendingPosts] = useState<PendingPost[]>([])
  const [pendingReports, setPendingReports] = useState<PendingReport[]>([])
  const [error, setError] = useState<string | null>(null)

  function load() {
    api
      .get<{ pendingPosts: PendingPost[]; pendingReports: PendingReport[] }>('/moderation/queue')
      .then((data) => {
        setPendingPosts(data.pendingPosts)
        setPendingReports(data.pendingReports)
      })
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [])

  async function decidePost(id: string, decision: 'APPROVED' | 'REJECTED') {
    try {
      await api.post(`/moderation/posts/${id}/decide`, { decision })
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function resolveReport(id: string, decision: 'DISMISSED' | 'ACTIONED') {
    try {
      await api.post(`/moderation/reports/${id}/resolve`, { decision })
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Moderation queue</h1>
        <ErrorBanner message={error} />

        <h3>Posts pending approval</h3>
        {pendingPosts.length === 0 && <p className="muted">Nothing pending.</p>}
        <div className="stack" style={{ marginBottom: 24 }}>
          {pendingPosts.map((p) => (
            <div key={p.id} className="card stack">
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {p.author.firstName} {p.author.lastName ?? ''} · {p.postType.label}
              </p>
              {p.title && <strong>{p.title}</strong>}
              <p style={{ margin: 0 }}>{p.content}</p>
              <div className="row">
                <button className="btn btn-outline" onClick={() => decidePost(p.id, 'REJECTED')}>
                  Reject
                </button>
                <button className="btn btn-accent" onClick={() => decidePost(p.id, 'APPROVED')}>
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>

        <h3>Open reports</h3>
        {pendingReports.length === 0 && <p className="muted">Nothing pending.</p>}
        <div className="stack">
          {pendingReports.map((r) => (
            <div key={r.id} className="card stack">
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Reported by {r.reporter.firstName} {r.reporter.lastName ?? ''}
              </p>
              <p style={{ margin: 0 }}>
                <strong>Reason:</strong> {r.reason}
              </p>
              {r.post && <p className="muted" style={{ margin: 0 }}>Post: &quot;{r.post.content}&quot;</p>}
              {r.comment && <p className="muted" style={{ margin: 0 }}>Comment: &quot;{r.comment.content}&quot;</p>}
              {r.reportedMember && (
                <p className="muted" style={{ margin: 0 }}>
                  Member: {r.reportedMember.firstName} {r.reportedMember.lastName ?? ''}
                </p>
              )}
              <div className="row">
                <button className="btn btn-outline" onClick={() => resolveReport(r.id, 'DISMISSED')}>
                  Dismiss
                </button>
                <button className="btn btn-danger" onClick={() => resolveReport(r.id, 'ACTIONED')}>
                  Take action
                </button>
              </div>
            </div>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
