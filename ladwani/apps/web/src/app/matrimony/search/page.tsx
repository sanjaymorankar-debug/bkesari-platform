'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, Avatar } from '../../../components/ui'

interface SearchResult {
  memberId: string
  firstName: string
  gender: string
  age: number | null
  currentCity: string | null
  education: string | null
  occupation: string | null
  photoUrl: string | null
}

interface LookupOption {
  id: string
  label: string
}

const INCOME_RANGES = [
  { value: '', label: 'Any income' },
  { value: 'BELOW_2L', label: 'Below ₹2 lakh' },
  { value: 'L2_5L', label: '₹2–5 lakh' },
  { value: 'L5_10L', label: '₹5–10 lakh' },
  { value: 'L10_25L', label: '₹10–25 lakh' },
  { value: 'ABOVE_25L', label: 'Above ₹25 lakh' },
]

export default function MatrimonySearchPage() {
  const [filters, setFilters] = useState({
    minAge: '',
    maxAge: '',
    gender: '',
    city: '',
    nativeVillage: '',
    educationLevelId: '',
    occupationId: '',
    incomeRange: '',
    maritalStatus: '',
    subgroup: '',
  })
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [educationLevels, setEducationLevels] = useState<LookupOption[]>([])
  const [occupations, setOccupations] = useState<LookupOption[]>([])

  useEffect(() => {
    api.get<LookupOption[]>('/config/education-levels').then(setEducationLevels).catch(() => undefined)
    api.get<LookupOption[]>('/config/occupations').then(setOccupations).catch(() => undefined)
  }, [])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const params = new URLSearchParams()
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value)
      })
      const found = await api.get<SearchResult[]>(`/matrimony/search?${params.toString()}`)
      setResults(found)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Search matrimonial profiles</h1>
        <form onSubmit={search} className="card stack" style={{ marginTop: 16 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input placeholder="Min age" type="number" value={filters.minAge} onChange={(e) => setFilters({ ...filters, minAge: e.target.value })} style={{ width: 100 }} />
            <input placeholder="Max age" type="number" value={filters.maxAge} onChange={(e) => setFilters({ ...filters, maxAge: e.target.value })} style={{ width: 100 }} />
            <select value={filters.gender} onChange={(e) => setFilters({ ...filters, gender: e.target.value })}>
              <option value="">Any gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
            <select value={filters.maritalStatus} onChange={(e) => setFilters({ ...filters, maritalStatus: e.target.value })}>
              <option value="">Any marital status</option>
              <option value="UNMARRIED">Unmarried</option>
              <option value="WIDOWED">Widowed</option>
              <option value="DIVORCED">Divorced</option>
            </select>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input placeholder="City" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
            <input
              placeholder="Native place"
              value={filters.nativeVillage}
              onChange={(e) => setFilters({ ...filters, nativeVillage: e.target.value })}
              style={{ flex: 1, minWidth: 140 }}
            />
            <input placeholder="Gotra / subgroup" value={filters.subgroup} onChange={(e) => setFilters({ ...filters, subgroup: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select value={filters.educationLevelId} onChange={(e) => setFilters({ ...filters, educationLevelId: e.target.value })}>
              <option value="">Any education</option>
              {educationLevels.map((el) => (
                <option key={el.id} value={el.id}>{el.label}</option>
              ))}
            </select>
            <select value={filters.occupationId} onChange={(e) => setFilters({ ...filters, occupationId: e.target.value })}>
              <option value="">Any occupation</option>
              {occupations.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            <select value={filters.incomeRange} onChange={(e) => setFilters({ ...filters, incomeRange: e.target.value })}>
              {INCOME_RANGES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button className="btn btn-primary" type="submit">Search</button>
          </div>
        </form>

        <ErrorBanner message={error} />

        <div className="stack" style={{ marginTop: 20 }}>
          {results?.length === 0 && <p className="muted">No matching profiles.</p>}
          {results?.map((r) => (
            <Link key={r.memberId} href={`/matrimony/${r.memberId}`} className="card row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
              <div className="row">
                {r.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photoUrl} alt={r.firstName} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <Avatar name={r.firstName} />
                )}
                <div>
                  <div style={{ fontWeight: 600 }}>{r.firstName}</div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {[r.age ? `${r.age} yrs` : null, r.currentCity, r.education, r.occupation].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <span className="btn btn-outline">View</span>
            </Link>
          ))}
        </div>
      </Shell>
    </RequireAuth>
  )
}
