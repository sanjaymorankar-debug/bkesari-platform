'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { api } from '../../../../lib/api-client'
import { errorMessage } from '../../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../../../components/ui'

interface InvoiceRow {
  id: string
  amountBilled: string
  amountPaid: string
  status: string
  dueDate: string
  outstanding: number
  lateFee: number
  feeRule: { feeType: { label: string } }
}

export default function FamilyFeesPage() {
  const { id } = useParams<{ id: string }>()
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<InvoiceRow[]>(`/fees/families/${id}/invoices`)
      .then(setInvoices)
      .catch((err) => setError(errorMessage(err)))
  }, [id])

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Fee invoices</h1>
        <ErrorBanner message={error} />

        {invoices === null && !error && <p className="muted">Loading…</p>}
        {invoices?.length === 0 && <p className="muted">No fee invoices yet.</p>}

        <div className="stack">
          {invoices?.map((inv) => (
            <Link
              key={inv.id}
              href={`/family/${id}/fees/${inv.id}`}
              className="card row"
              style={{ textDecoration: 'none', color: 'inherit', justifyContent: 'space-between' }}
            >
              <div>
                <h3 style={{ marginBottom: 4 }}>{inv.feeRule.feeType.label}</h3>
                <p className="muted mono" style={{ margin: 0, fontSize: 13 }}>
                  Due {new Date(inv.dueDate).toLocaleDateString()} · Billed ₹{Number(inv.amountBilled).toLocaleString('en-IN')}
                  {inv.lateFee > 0 && ` · Late fee ₹${inv.lateFee.toLocaleString('en-IN')}`}
                </p>
              </div>
              <div className="row" style={{ alignItems: 'center' }}>
                {inv.outstanding > 0 && <span className="mono">₹{inv.outstanding.toLocaleString('en-IN')} due</span>}
                <StatusPill status={inv.status} />
              </div>
            </Link>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
