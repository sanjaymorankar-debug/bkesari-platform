'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../components/ui'

interface AssetSummary {
  id: string
  name: string
  city: string | null
  capacity: number | null
  category: { label: string }
  photos: { url: string }[]
  pricing: { amount: string }[]
}

interface CategoryOption {
  code: string
  label: string
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<AssetSummary[] | null>(null)
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [filters, setFilters] = useState({ city: '', categoryCode: '', minCapacity: '', minPrice: '', maxPrice: '', minRating: '', date: '' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<CategoryOption[]>('/config/asset-categories').then(setCategories).catch(() => undefined)
  }, [])

  function load() {
    const params = new URLSearchParams()
    if (filters.city) params.set('city', filters.city)
    if (filters.categoryCode) params.set('categoryCode', filters.categoryCode)
    if (filters.minCapacity) params.set('minCapacity', filters.minCapacity)
    if (filters.minPrice) params.set('minPrice', filters.minPrice)
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice)
    if (filters.minRating) params.set('minRating', filters.minRating)
    if (filters.date) params.set('date', filters.date)
    api
      .get<AssetSummary[]>(`/assets/search?${params.toString()}`)
      .then(setAssets)
      .catch((err) => setError(errorMessage(err)))
  }

  useEffect(load, [])

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>Community Services</h1>
          <Link href="/assets/new" className="btn btn-accent">
            List a service
          </Link>
        </div>

        <form
          className="card stack"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault()
            load()
          }}
        >
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input placeholder="City" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
            <select value={filters.categoryCode} onChange={(e) => setFilters({ ...filters, categoryCode: e.target.value })}>
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Min capacity"
              value={filters.minCapacity}
              onChange={(e) => setFilters({ ...filters, minCapacity: e.target.value })}
              style={{ width: 130 }}
            />
          </div>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="number" placeholder="Min price" value={filters.minPrice} onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })} style={{ width: 110 }} />
            <input type="number" placeholder="Max price" value={filters.maxPrice} onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })} style={{ width: 110 }} />
            <select value={filters.minRating} onChange={(e) => setFilters({ ...filters, minRating: e.target.value })}>
              <option value="">Any rating</option>
              <option value="4">4+ stars</option>
              <option value="3">3+ stars</option>
              <option value="2">2+ stars</option>
            </select>
            <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} />
            <button className="btn btn-primary" type="submit">Search</button>
          </div>
        </form>

        <ErrorBanner message={error} />

        <div className="stack" style={{ marginTop: 20 }}>
          {assets?.length === 0 && <p className="muted">No services found.</p>}
          {assets?.map((a) => (
            <Link key={a.id} href={`/assets/${a.id}`} className="card row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
              <div>
                <h3 style={{ marginBottom: 4 }}>{a.name}</h3>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {a.category.label} {a.city && `· ${a.city}`} {a.capacity && `· up to ${a.capacity} guests`}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                {a.pricing[0] && <div className="mono" style={{ fontWeight: 600 }}>₹{Number(a.pricing[0].amount).toLocaleString('en-IN')}</div>}
                <span className="btn btn-outline" style={{ marginTop: 6 }}>
                  View
                </span>
              </div>
            </Link>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
