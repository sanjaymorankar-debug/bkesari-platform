'use client'

import { useState } from 'react'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../../components/ui'

interface ReconciliationResult {
  id: string
  runDate: string
  gatewayCode: string
  mismatches: { transactionId: string; ourStatus: string; gatewayStatus: string; resolution: string }[]
}

interface PaymentTransaction {
  id: string
  status: string
  amount: string
  purposeType: string
  purposeId: string
  refunds: { id: string; amount: string; status: string }[]
}

export default function AdminPaymentsPage() {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<ReconciliationResult | null>(null)

  const [lookupId, setLookupId] = useState('')
  const [transaction, setTransaction] = useState<PaymentTransaction | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')

  async function runReconciliation() {
    setError(null)
    setRunning(true)
    try {
      const result = await api.post<ReconciliationResult>('/payments/reconciliation/run')
      setLastRun(result)
      setNotice(result.mismatches.length === 0 ? 'Reconciliation run clean — no mismatches found.' : `Reconciliation flagged ${result.mismatches.length} mismatch(es).`)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  async function lookupTransaction(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setTransaction(null)
    try {
      const txn = await api.get<PaymentTransaction>(`/payments/${lookupId}`)
      setTransaction(txn)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function refund(e: React.FormEvent) {
    e.preventDefault()
    if (!transaction) return
    setError(null)
    try {
      await api.post(`/payments/${transaction.id}/refund`, { amount: Number(refundAmount), reason: refundReason || undefined })
      setNotice('Refund initiated.')
      setRefundAmount('')
      setRefundReason('')
      const txn = await api.get<PaymentTransaction>(`/payments/${transaction.id}`)
      setTransaction(txn)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Payments administration</h1>
        <ErrorBanner message={error} />
        {notice && <div className="card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 16 }}>{notice}</div>}

        <div className="card stack" style={{ marginBottom: 20 }}>
          <h3>Reconciliation</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Manually triggered — no job scheduler exists yet. Checks transactions stuck pending/processing for more than 10 minutes against the gateway.
          </p>
          <button className="btn btn-accent" onClick={runReconciliation} disabled={running} style={{ alignSelf: 'flex-start' }}>
            {running ? 'Running…' : 'Run reconciliation now'}
          </button>
          {lastRun && (
            <div className="stack" style={{ marginTop: 8 }}>
              <p className="muted mono" style={{ margin: 0, fontSize: 13 }}>{new Date(lastRun.runDate).toLocaleString()} · gateway {lastRun.gatewayCode}</p>
              {lastRun.mismatches.length === 0 && <p className="muted">No mismatches.</p>}
              {lastRun.mismatches.map((m, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono">{m.transactionId}</span>
                  <span>{m.ourStatus} → {m.gatewayStatus} ({m.resolution.replace(/_/g, ' ')})</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={lookupTransaction} className="card stack" style={{ marginBottom: 20 }}>
          <h3>Look up a payment transaction</h3>
          <div className="field">
            <label htmlFor="lookup-id">Transaction ID</label>
            <input id="lookup-id" value={lookupId} onChange={(e) => setLookupId(e.target.value)} required />
          </div>
          <button className="btn btn-outline" type="submit" style={{ alignSelf: 'flex-start' }}>
            Look up
          </button>
        </form>

        {transaction && (
          <div className="card stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{transaction.purposeType} · {transaction.purposeId}</h3>
              <StatusPill status={transaction.status} />
            </div>
            <p className="mono" style={{ margin: 0 }}>₹{Number(transaction.amount).toLocaleString('en-IN')}</p>

            {transaction.refunds.length > 0 && (
              <div className="stack">
                <h4 style={{ margin: 0 }}>Refunds</h4>
                {transaction.refunds.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="mono">₹{Number(r.amount).toLocaleString('en-IN')}</span>
                    <StatusPill status={r.status} />
                  </div>
                ))}
              </div>
            )}

            {(transaction.status === 'SUCCESSFUL' || transaction.status === 'PARTIALLY_REFUNDED') && (
              <form onSubmit={refund} className="stack">
                <h4 style={{ margin: 0 }}>Issue a refund</h4>
                <div className="field">
                  <label htmlFor="refund-amount">Amount (₹)</label>
                  <input id="refund-amount" type="number" min={0.01} step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor="refund-reason">Reason (optional)</label>
                  <input id="refund-reason" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
                </div>
                <button className="btn btn-danger" type="submit" style={{ alignSelf: 'flex-start' }}>
                  Issue refund
                </button>
              </form>
            )}
          </div>
        )}
      </Shell>
    </RequireAuth>
  )
}
