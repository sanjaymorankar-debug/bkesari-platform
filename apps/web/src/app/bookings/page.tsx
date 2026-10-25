'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, ApiError } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../components/ui'

interface BookingRow {
  id: string
  status: string
  bookingType: string
  date: string
  totalAmount: string
  asset: { name: string }
  user?: { member?: { firstName: string; lastName: string | null } | null }
}

export default function BookingsPage() {
  const [tab, setTab] = useState<'mine' | 'owner'>('mine')
  const [mine, setMine] = useState<BookingRow[] | null>(null)
  const [owner, setOwner] = useState<BookingRow[] | null>(null)
  const [hasOwnerAccess, setHasOwnerAccess] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<BookingRow[]>('/bookings/mine').then(setMine).catch((err) => setError(errorMessage(err)))
    api
      .get<BookingRow[]>('/bookings/owner')
      .then(setOwner)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) setHasOwnerAccess(false)
        else setError(errorMessage(err))
      })
  }, [])

  const rows = tab === 'mine' ? mine : owner

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>Bookings</h1>
          <Link href="/bookings/verify-qr" className="btn btn-outline">
            Check-in scanner
          </Link>
        </div>

        <div className="row" style={{ margin: '16px 0' }}>
          <button className={tab === 'mine' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setTab('mine')}>
            My bookings
          </button>
          {hasOwnerAccess && (
            <button className={tab === 'owner' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setTab('owner')}>
              Bookings on my services
            </button>
          )}
        </div>

        <ErrorBanner message={error} />

        <div className="stack">
          {rows?.length === 0 && <p className="muted">Nothing here yet.</p>}
          {rows?.map((b) => (
            <Link key={b.id} href={`/bookings/${b.id}`} className="card row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
              <div>
                <strong>{b.asset.name}</strong>
                <p className="muted mono" style={{ margin: '4px 0 0', fontSize: 13 }}>
                  {new Date(b.date).toLocaleDateString()} · ₹{Number(b.totalAmount).toLocaleString('en-IN')}
                  {tab === 'owner' && b.user?.member && ` · ${b.user.member.firstName} ${b.user.member.lastName ?? ''}`}
                </p>
              </div>
              <StatusPill status={b.status} />
            </Link>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
