'use client'

import { useEffect, useState } from 'react'
import { api } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import { payViaDevGateway } from '../../lib/pay'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../components/ui'

interface Cause {
  id: string
  code: string
  label: string
}

interface Donation {
  id: string
  amount: string
  paymentTransactionId: string | null
  createdAt: string
  cause: { label: string }
}

export default function DonationsPage() {
  const [causes, setCauses] = useState<Cause[] | null>(null)
  const [donations, setDonations] = useState<Donation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedCause, setSelectedCause] = useState('')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function load() {
    api
      .get<Cause[]>('/donations/causes')
      .then((rows) => {
        setCauses(rows)
        if (rows.length > 0) setSelectedCause((c) => c || rows[0].code)
      })
      .catch((err) => setError(errorMessage(err)))
    api
      .get<Donation[]>('/donations/mine')
      .then(setDonations)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [])

  async function donate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const donation = await api.post<{ id: string; amount: string }>('/donations', { causeCode: selectedCause, amount: Number(amount) })
      await payViaDevGateway('DONATION', donation.id, Number(donation.amount))
      setNotice('Thank you — your donation was received (dev simulation).')
      setAmount('')
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Donations</h1>
        <ErrorBanner message={error} />
        {notice && <div className="card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 16 }}>{notice}</div>}

        {causes && causes.length > 0 && (
          <form onSubmit={donate} className="card stack" style={{ marginBottom: 24 }}>
            <h3>Make a donation</h3>
            <div className="field">
              <label htmlFor="cause">Cause</label>
              <select id="cause" value={selectedCause} onChange={(e) => setSelectedCause(e.target.value)}>
                {causes.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="amount">Amount (₹)</label>
              <input id="amount" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <button className="btn btn-accent" type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
              {submitting ? 'Processing…' : 'Donate now (dev)'}
            </button>
          </form>
        )}
        {causes?.length === 0 && <p className="muted">No active donation causes right now.</p>}

        <h3>My donations</h3>
        {donations?.length === 0 && <p className="muted">You haven&apos;t made any donations yet.</p>}
        <div className="stack">
          {donations?.map((d) => (
            <div key={d.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{d.cause.label}</strong>
                <p className="muted mono" style={{ margin: 0, fontSize: 13 }}>{new Date(d.createdAt).toLocaleString()}</p>
              </div>
              <div className="row" style={{ alignItems: 'center' }}>
                <span className="mono">₹{Number(d.amount).toLocaleString('en-IN')}</span>
                <StatusPill status={d.paymentTransactionId ? 'PAID' : 'PENDING'} />
              </div>
            </div>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
