'use client'

import { useEffect, useState } from 'react'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

type Frequency = 'ONE_TIME' | 'MONTHLY' | 'ANNUAL' | 'EVENT'

interface FeeType {
  id: string
  code: string
  label: string
}

interface FinancialYear {
  id: string
  label: string
}

interface FeeRule {
  id: string
  amount: string
  lateFeeAmount: string
  gracePeriodDays: number
  feeType: { label: string }
  financialYear: { label: string }
}

export default function AdminFeesPage() {
  const [feeTypes, setFeeTypes] = useState<FeeType[]>([])
  const [financialYears, setFinancialYears] = useState<FinancialYear[]>([])
  const [rules, setRules] = useState<FeeRule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [typeCode, setTypeCode] = useState('')
  const [typeLabel, setTypeLabel] = useState('')
  const [typeDefaultAmount, setTypeDefaultAmount] = useState('')
  const [typeFrequency, setTypeFrequency] = useState<Frequency>('ANNUAL')

  const [fyLabel, setFyLabel] = useState('')
  const [fyStart, setFyStart] = useState('')
  const [fyEnd, setFyEnd] = useState('')

  const [ruleFeeTypeCode, setRuleFeeTypeCode] = useState('')
  const [ruleFyLabel, setRuleFyLabel] = useState('')
  const [ruleAmount, setRuleAmount] = useState('')
  const [ruleLateFee, setRuleLateFee] = useState('')
  const [ruleGraceDays, setRuleGraceDays] = useState('')

  const [assignFamilyId, setAssignFamilyId] = useState('')
  const [assignFeeRuleId, setAssignFeeRuleId] = useState('')

  function loadRules() {
    api
      .get<FeeRule[]>('/fees/rules')
      .then(setRules)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(loadRules, [])

  async function createType(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const created = await api.post<FeeType>('/fees/types', {
        code: typeCode,
        label: typeLabel,
        defaultAmount: Number(typeDefaultAmount),
        frequency: typeFrequency,
      })
      setFeeTypes((prev) => [...prev, created])
      setNotice(`Fee type "${created.label}" created.`)
      setTypeCode('')
      setTypeLabel('')
      setTypeDefaultAmount('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function createFinancialYear(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const created = await api.post<FinancialYear>('/fees/financial-years', { label: fyLabel, startDate: fyStart, endDate: fyEnd })
      setFinancialYears((prev) => [...prev, created])
      setNotice(`Financial year "${created.label}" created.`)
      setFyLabel('')
      setFyStart('')
      setFyEnd('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function createRule(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/fees/rules', {
        feeTypeCode: ruleFeeTypeCode,
        financialYearLabel: ruleFyLabel,
        amount: Number(ruleAmount),
        lateFeeAmount: ruleLateFee ? Number(ruleLateFee) : undefined,
        gracePeriodDays: ruleGraceDays ? Number(ruleGraceDays) : undefined,
      })
      setNotice('Fee rule created.')
      setRuleAmount('')
      setRuleLateFee('')
      setRuleGraceDays('')
      loadRules()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/fees/assign', { familyId: assignFamilyId, feeRuleId: assignFeeRuleId })
      setNotice('Fee assigned — an invoice has been generated for the family and its Karta notified.')
      setAssignFamilyId('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Fee administration</h1>
        <ErrorBanner message={error} />
        {notice && <div className="card" style={{ borderColor: 'var(--success)', color: 'var(--success)', marginBottom: 16 }}>{notice}</div>}

        <div className="stack">
          <form onSubmit={createType} className="card stack">
            <h3>New fee type</h3>
            <div className="field">
              <label htmlFor="type-code">Code</label>
              <input id="type-code" value={typeCode} onChange={(e) => setTypeCode(e.target.value)} placeholder="ANNUAL_MEMBERSHIP" required />
            </div>
            <div className="field">
              <label htmlFor="type-label">Label</label>
              <input id="type-label" value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} placeholder="Annual Membership" required />
            </div>
            <div className="field">
              <label htmlFor="type-amount">Default amount (₹)</label>
              <input id="type-amount" type="number" min={0} step="0.01" value={typeDefaultAmount} onChange={(e) => setTypeDefaultAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="type-frequency">Frequency</label>
              <select id="type-frequency" value={typeFrequency} onChange={(e) => setTypeFrequency(e.target.value as Frequency)}>
                <option value="ONE_TIME">One time</option>
                <option value="MONTHLY">Monthly</option>
                <option value="ANNUAL">Annual</option>
                <option value="EVENT">Event</option>
              </select>
            </div>
            <button className="btn btn-accent" type="submit" style={{ alignSelf: 'flex-start' }}>
              Create fee type
            </button>
          </form>

          <form onSubmit={createFinancialYear} className="card stack">
            <h3>New financial year</h3>
            <div className="field">
              <label htmlFor="fy-label">Label</label>
              <input id="fy-label" value={fyLabel} onChange={(e) => setFyLabel(e.target.value)} placeholder="2026-27" required />
            </div>
            <div className="field">
              <label htmlFor="fy-start">Start date</label>
              <input id="fy-start" type="date" value={fyStart} onChange={(e) => setFyStart(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="fy-end">End date</label>
              <input id="fy-end" type="date" value={fyEnd} onChange={(e) => setFyEnd(e.target.value)} required />
            </div>
            <button className="btn btn-accent" type="submit" style={{ alignSelf: 'flex-start' }}>
              Create financial year
            </button>
          </form>

          <form onSubmit={createRule} className="card stack">
            <h3>New fee rule</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>Reference an existing fee type code and financial year label.</p>
            <div className="field">
              <label htmlFor="rule-type-code">Fee type code</label>
              <input id="rule-type-code" value={ruleFeeTypeCode} onChange={(e) => setRuleFeeTypeCode(e.target.value)} placeholder="ANNUAL_MEMBERSHIP" required />
            </div>
            <div className="field">
              <label htmlFor="rule-fy-label">Financial year label</label>
              <input id="rule-fy-label" value={ruleFyLabel} onChange={(e) => setRuleFyLabel(e.target.value)} placeholder="2026-27" required />
            </div>
            <div className="field">
              <label htmlFor="rule-amount">Amount (₹)</label>
              <input id="rule-amount" type="number" min={0} step="0.01" value={ruleAmount} onChange={(e) => setRuleAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="rule-late-fee">Late fee (₹, optional)</label>
              <input id="rule-late-fee" type="number" min={0} step="0.01" value={ruleLateFee} onChange={(e) => setRuleLateFee(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="rule-grace-days">Grace period (days, optional)</label>
              <input id="rule-grace-days" type="number" min={0} value={ruleGraceDays} onChange={(e) => setRuleGraceDays(e.target.value)} />
            </div>
            <button className="btn btn-accent" type="submit" style={{ alignSelf: 'flex-start' }}>
              Create fee rule
            </button>
          </form>

          <div className="card stack">
            <h3>Existing fee rules</h3>
            {rules.length === 0 && <p className="muted">No fee rules yet.</p>}
            {rules.map((r) => (
              <div key={r.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  {r.feeType.label} · {r.financialYear.label}
                </span>
                <span className="mono">
                  ₹{Number(r.amount).toLocaleString('en-IN')}
                  {Number(r.lateFeeAmount) > 0 && ` (+₹${Number(r.lateFeeAmount).toLocaleString('en-IN')} after ${r.gracePeriodDays}d)`}
                </span>
              </div>
            ))}
          </div>

          <form onSubmit={assign} className="card stack">
            <h3>Assign a fee to a family</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Immediately generates an invoice and notifies the family&apos;s Karta.
            </p>
            <div className="field">
              <label htmlFor="assign-family">Family ID</label>
              <input id="assign-family" value={assignFamilyId} onChange={(e) => setAssignFamilyId(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="assign-rule">Fee rule</label>
              <select id="assign-rule" value={assignFeeRuleId} onChange={(e) => setAssignFeeRuleId(e.target.value)} required>
                <option value="">Select a fee rule…</option>
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.feeType.label} · {r.financialYear.label} · ₹{Number(r.amount).toLocaleString('en-IN')}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-accent" type="submit" style={{ alignSelf: 'flex-start' }}>
              Assign & generate invoice
            </button>
          </form>
        </div>
      </Shell>
    </RequireAuth>
  )
}
