'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { api } from '../../../../../lib/api-client'
import { errorMessage } from '../../../../../lib/auth-context'
import { payViaDevGateway } from '../../../../../lib/pay'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../../../../components/ui'

type OfflineMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE'

interface InvoiceDetail {
  id: string
  amountBilled: string
  amountPaid: string
  status: string
  dueDate: string
  outstanding: number
  lateFee: number
  items: { description: string; amount: string }[]
  waivers: { reductionAmount: string; reason: string | null }[]
  offlinePayments: { id: string; amount: string; method: string; status: string; reference: string | null; createdAt: string }[]
  feeRule: { feeType: { label: string } }
  family: { name: string }
}

const SETTLED = new Set(['PAID', 'WAIVED'])

export default function FeeInvoiceDetailPage() {
  const { invoiceId } = useParams<{ id: string; invoiceId: string }>()
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [offlineAmount, setOfflineAmount] = useState('')
  const [offlineMethod, setOfflineMethod] = useState<OfflineMethod>('CASH')
  const [offlineReference, setOfflineReference] = useState('')

  function load() {
    api
      .get<InvoiceDetail>(`/fees/invoices/${invoiceId}`)
      .then(setInvoice)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [invoiceId])

  async function payNow() {
    if (!invoice) return
    setError(null)
    setPaying(true)
    try {
      await payViaDevGateway('FEE', invoice.id, invoice.outstanding)
      setNotice('Payment successful (dev simulation — real Razorpay checkout lands once live credentials are configured).')
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPaying(false)
    }
  }

  async function recordOffline(e: React.FormEvent) {
    e.preventDefault()
    if (!invoice) return
    setError(null)
    try {
      await api.post(`/fees/invoices/${invoice.id}/offline-payments`, {
        amount: Number(offlineAmount),
        method: offlineMethod,
        reference: offlineReference || undefined,
      })
      setNotice('Offline payment recorded and submitted for Operator/Admin verification.')
      setOfflineAmount('')
      setOfflineReference('')
      load()
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

        {invoice && (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h1>{invoice.feeRule.feeType.label}</h1>
              <StatusPill status={invoice.status} />
            </div>
            <p className="muted">{invoice.family.name} · Due {new Date(invoice.dueDate).toLocaleDateString()}</p>

            <div className="card stack" style={{ marginBottom: 20 }}>
              {invoice.items.map((item, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">{item.description}</span>
                  <span className="mono">₹{Number(item.amount).toLocaleString('en-IN')}</span>
                </div>
              ))}
              {invoice.lateFee > 0 && (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Late fee</span>
                  <span className="mono">₹{invoice.lateFee.toLocaleString('en-IN')}</span>
                </div>
              )}
              {invoice.waivers.map((w, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Waiver{w.reason ? ` — ${w.reason}` : ''}</span>
                  <span className="mono">−₹{Number(w.reductionAmount).toLocaleString('en-IN')}</span>
                </div>
              ))}
              <div className="row" style={{ justifyContent: 'space-between', fontWeight: 600 }}>
                <span>Outstanding</span>
                <span className="mono">₹{invoice.outstanding.toLocaleString('en-IN')}</span>
              </div>
            </div>

            {!SETTLED.has(invoice.status) && invoice.outstanding > 0 && (
              <div className="row" style={{ marginBottom: 20 }}>
                <button className="btn btn-accent" onClick={payNow} disabled={paying}>
                  {paying ? 'Processing…' : `Pay ₹${invoice.outstanding.toLocaleString('en-IN')} now (dev)`}
                </button>
              </div>
            )}

            {invoice.offlinePayments.length > 0 && (
              <>
                <h3>Offline payments</h3>
                <div className="stack" style={{ marginBottom: 20 }}>
                  {invoice.offlinePayments.map((op) => (
                    <div key={op.id} className="card row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <span className="mono">₹{Number(op.amount).toLocaleString('en-IN')}</span>
                        <span className="muted"> · {op.method.replace(/_/g, ' ')}{op.reference ? ` · ${op.reference}` : ''}</span>
                      </div>
                      <StatusPill status={op.status} />
                    </div>
                  ))}
                </div>
              </>
            )}

            {!SETTLED.has(invoice.status) && (
              <form onSubmit={recordOffline} className="card stack">
                <h3>Record an offline payment</h3>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  For cash, bank transfer, or cheque payments. An Operator or Admin must verify it before it counts toward the invoice.
                </p>
                <div className="field">
                  <label htmlFor="offline-amount">Amount</label>
                  <input
                    id="offline-amount"
                    type="number"
                    min={1}
                    max={invoice.outstanding}
                    step="0.01"
                    value={offlineAmount}
                    onChange={(e) => setOfflineAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="offline-method">Method</label>
                  <select id="offline-method" value={offlineMethod} onChange={(e) => setOfflineMethod(e.target.value as OfflineMethod)}>
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank transfer</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="offline-reference">Reference (optional)</label>
                  <input id="offline-reference" value={offlineReference} onChange={(e) => setOfflineReference(e.target.value)} placeholder="Receipt / cheque number" />
                </div>
                <button className="btn btn-outline" type="submit" style={{ alignSelf: 'flex-start' }}>
                  Record payment
                </button>
              </form>
            )}
          </>
        )}
      </Shell>
    </RequireAuth>
  )
}
