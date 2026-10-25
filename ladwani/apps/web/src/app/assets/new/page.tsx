'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

interface AssetCategory {
  code: string
  label: string
  isActive: boolean
}

export default function NewAssetPage() {
  const router = useRouter()
  const [categories, setCategories] = useState<AssetCategory[]>([])
  const [form, setForm] = useState({
    categoryCode: '',
    name: '',
    description: '',
    city: '',
    capacity: '',
    basePrice: '',
    bookingApprovalRequired: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api
      .get<AssetCategory[]>('/config/asset-categories')
      .then((cats) => {
        const active = cats.filter((c) => c.isActive)
        setCategories(active)
        if (active.length > 0) setForm((f) => ({ ...f, categoryCode: f.categoryCode || active[0].code }))
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/assets', {
        categoryCode: form.categoryCode,
        name: form.name,
        description: form.description || undefined,
        city: form.city || undefined,
        capacity: form.capacity ? Number(form.capacity) : undefined,
        basePrice: form.basePrice ? Number(form.basePrice) : undefined,
        bookingApprovalRequired: form.bookingApprovalRequired,
      })
      router.push('/assets')
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
        <h1>List a community service</h1>
        <p className="muted">This goes to an Operator for verification before it appears in search.</p>
        <form onSubmit={submit} className="card stack" style={{ marginTop: 20 }}>
          <ErrorBanner message={error} />
          <div className="field">
            <label htmlFor="categoryCode">Category</label>
            <select id="categoryCode" value={form.categoryCode} onChange={(e) => setForm({ ...form, categoryCode: e.target.value })}>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <textarea id="description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="city">City</label>
              <input id="city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="capacity">Capacity</label>
              <input id="capacity" type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="basePrice">Base price (₹)</label>
              <input id="basePrice" type="number" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} />
            </div>
          </div>
          <label className="row" style={{ gap: 8 }}>
            <input
              type="checkbox"
              checked={form.bookingApprovalRequired}
              onChange={(e) => setForm({ ...form, bookingApprovalRequired: e.target.checked })}
            />
            Require my approval before a booking is confirmed (request-based, not instant)
          </label>
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ alignSelf: 'flex-start' }}>
            {submitting ? 'Submitting…' : 'Submit for verification'}
          </button>
        </form>
      </Shell>
    </RequireAuth>
  )
}
