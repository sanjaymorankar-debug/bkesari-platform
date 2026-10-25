'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../components/ui'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  isRead: boolean
  createdAt: string
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function load() {
    api
      .get<NotificationRow[]>('/notifications')
      .then(setNotifications)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [])

  async function markRead(id: string) {
    try {
      await api.post(`/notifications/${id}/read`)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all')
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
          <h1>Notifications</h1>
          <button className="btn btn-outline" onClick={markAllRead}>
            Mark all read
          </button>
        </div>
        <ErrorBanner message={error} />

        {notifications?.length === 0 && <p className="muted">No notifications yet.</p>}

        <div className="stack" style={{ marginTop: 16 }}>
          {notifications?.map((n) => (
            <div
              key={n.id}
              className="card"
              style={{ borderColor: n.isRead ? 'var(--border)' : 'var(--accent)', cursor: n.isRead ? 'default' : 'pointer' }}
              onClick={() => !n.isRead && markRead(n.id)}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{n.title}</strong>
                <span className="muted mono" style={{ fontSize: 12 }}>
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </div>
              {n.body && <p className="muted" style={{ margin: '4px 0 0' }}>{n.body}</p>}
            </div>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
