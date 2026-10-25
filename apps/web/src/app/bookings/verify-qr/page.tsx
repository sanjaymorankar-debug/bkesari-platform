'use client'

import { useState } from 'react'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../../components/ui'

interface CheckIn {
  bookingId: string
  assetName: string
  date: string
  slot: string
  status: string
  guests: string[]
}

export default function VerifyQrPage() {
  const [token, setToken] = useState('')
  const [result, setResult] = useState<CheckIn | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    try {
      const data = await api.post<CheckIn>('/bookings/verify-qr', { token: token.trim() })
      setResult(data)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Booking check-in</h1>
        <p className="muted">Paste the guest&apos;s check-in code to verify their booking.</p>

        <form onSubmit={verify} className="card row" style={{ marginTop: 16 }}>
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Check-in code…" style={{ flex: 1 }} autoFocus />
          <button className="btn btn-primary" type="submit">
            Verify
          </button>
        </form>

        <ErrorBanner message={error} />

        {result && (
          <div className="card stack" style={{ marginTop: 20, borderColor: 'var(--success)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{result.assetName}</h3>
              <StatusPill status={result.status} />
            </div>
            <p style={{ margin: 0 }}>
              {new Date(result.date).toLocaleDateString()} · {result.slot}
            </p>
            {result.guests.length > 0 && <p className="muted" style={{ margin: 0 }}>Guests: {result.guests.join(', ')}</p>}
          </div>
        )}
      </Shell>
    </RequireAuth>
  )
}
