'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useAuth } from '../../../lib/auth-context'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../../components/ui'

interface BookingDetail {
  id: string
  status: string
  bookingType: string
  date: string
  slot: string
  totalAmount: string
  userId: string
  asset: { id: string; name: string; assetOwner: { userId: string } }
  items: { description: string; unitPrice: string }[]
  guests: { name: string }[]
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [booking, setBooking] = useState<BookingDetail | null>(null)
  const [qrToken, setQrToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewScore, setReviewScore] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewSubmitted, setReviewSubmitted] = useState(false)

  function load() {
    api
      .get<BookingDetail>(`/bookings/${id}`)
      .then(setBooking)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [id])

  const isRenter = booking?.userId === user?.id
  const isOwner = booking?.asset.assetOwner.userId === user?.id

  async function decide(decision: 'APPROVED' | 'DECLINED') {
    setError(null)
    try {
      await api.post(`/bookings/${id}/decide`, { decision })
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function confirmPayment() {
    setError(null)
    try {
      const result = await api.post<{ qrToken: string }>(`/bookings/${id}/confirm-payment`)
      setQrToken(result.qrToken)
      setNotice('Payment confirmed (dev simulation — real gateway integration lands in a later milestone).')
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function cancel() {
    if (!confirm('Cancel this booking?')) return
    setError(null)
    try {
      const result = await api.post<{ refundAmount: number }>(`/bookings/${id}/cancel`)
      setNotice(result.refundAmount > 0 ? `Cancelled. Refund due: ₹${result.refundAmount.toLocaleString('en-IN')}` : 'Cancelled.')
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function complete() {
    setError(null)
    try {
      await api.post(`/bookings/${id}/complete`)
      load()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function loadQr() {
    setError(null)
    try {
      const result = await api.get<{ token: string }>(`/bookings/${id}/qr`)
      setQrToken(result.token)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function submitReview(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/reviews', { bookingId: id, overallScore: reviewScore, comment: reviewComment || undefined })
      setReviewSubmitted(true)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <ErrorBanner message={error} />
        {notice && <div className="card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 16 }}>{notice}</div>}

        {booking && (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h1>{booking.asset.name}</h1>
              <StatusPill status={booking.status} />
            </div>
            <p className="muted">
              {new Date(booking.date).toLocaleDateString()} · {booking.slot} · {booking.bookingType}
            </p>

            <div className="card stack" style={{ marginBottom: 20 }}>
              {booking.items.map((item, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">{item.description}</span>
                  <span className="mono">₹{Number(item.unitPrice).toLocaleString('en-IN')}</span>
                </div>
              ))}
              <div className="row" style={{ justifyContent: 'space-between', fontWeight: 600 }}>
                <span>Total</span>
                <span className="mono">₹{Number(booking.totalAmount).toLocaleString('en-IN')}</span>
              </div>
              {booking.guests.length > 0 && <p className="muted" style={{ margin: 0 }}>Guests: {booking.guests.map((g) => g.name).join(', ')}</p>}
            </div>

            <div className="row" style={{ marginBottom: 20, flexWrap: 'wrap' }}>
              {isOwner && booking.status === 'REQUESTED' && booking.bookingType === 'REQUEST' && (
                <>
                  <button className="btn btn-outline" onClick={() => decide('DECLINED')}>
                    Decline
                  </button>
                  <button className="btn btn-accent" onClick={() => decide('APPROVED')}>
                    Approve
                  </button>
                </>
              )}
              {isRenter && (booking.status === 'REQUESTED' || booking.status === 'APPROVED') && (
                <button className="btn btn-accent" onClick={confirmPayment}>
                  Pay now (dev)
                </button>
              )}
              {isRenter && ['REQUESTED', 'APPROVED', 'CONFIRMED'].includes(booking.status) && (
                <button className="btn btn-danger" onClick={cancel}>
                  Cancel booking
                </button>
              )}
              {isOwner && booking.status === 'CONFIRMED' && (
                <button className="btn btn-outline" onClick={complete}>
                  Mark completed
                </button>
              )}
              {isRenter && booking.status === 'CONFIRMED' && !qrToken && (
                <button className="btn btn-outline" onClick={loadQr}>
                  Show check-in QR
                </button>
              )}
            </div>

            {qrToken && (
              <div className="card" style={{ marginBottom: 20 }}>
                <h3>Check-in code</h3>
                <p className="muted">Show this to asset staff at check-in.</p>
                <p className="mono" style={{ wordBreak: 'break-all', fontSize: 13, background: 'var(--bg)', padding: 12, borderRadius: 8 }}>
                  {qrToken}
                </p>
              </div>
            )}

            {isRenter && booking.status === 'COMPLETED' && !reviewSubmitted && (
              <form onSubmit={submitReview} className="card stack">
                <h3>Leave a review</h3>
                <div className="field">
                  <label htmlFor="score">Overall rating</label>
                  <select id="score" value={reviewScore} onChange={(e) => setReviewScore(Number(e.target.value))}>
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n} star{n > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="comment">Comment</label>
                  <textarea id="comment" rows={3} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} />
                </div>
                <button className="btn btn-primary" type="submit" style={{ alignSelf: 'flex-start' }}>
                  Submit review
                </button>
              </form>
            )}
            {reviewSubmitted && <div className="card" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>Thanks for your review!</div>}
          </>
        )}
      </Shell>
    </RequireAuth>
  )
}
