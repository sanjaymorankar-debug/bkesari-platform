'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, Avatar, StatusPill } from '../../../components/ui'

interface MemberResult {
  id: string
  firstName: string
  lastName: string | null
  status: string
  currentCity?: string
  education?: string
  occupation?: string
}

interface LookupOption {
  id: string
  label: string
}

const PAGE_SIZE = 20

export default function MemberSearchPage() {
  const [filters, setFilters] = useState({
    q: '',
    city: '',
    state: '',
    gender: '',
    maritalStatus: '',
    educationLevelId: '',
    occupationId: '',
    minAge: '',
    maxAge: '',
    matrimonyAvailable: false,
  })
  const [page, setPage] = useState(1)
  const [results, setResults] = useState<MemberResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [educationLevels, setEducationLevels] = useState<LookupOption[]>([])
  const [occupations, setOccupations] = useState<LookupOption[]>([])

  useEffect(() => {
    api.get<LookupOption[]>('/config/education-levels').then(setEducationLevels).catch(() => undefined)
    api.get<LookupOption[]>('/config/occupations').then(setOccupations).catch(() => undefined)
  }, [])

  async function search(e?: React.FormEvent, targetPage = 1) {
    e?.preventDefault()
    setError(null)
    setPage(targetPage)
    try {
      const params = new URLSearchParams()
      if (filters.q) params.set('q', filters.q)
      if (filters.city) params.set('city', filters.city)
      if (filters.state) params.set('state', filters.state)
      if (filters.gender) params.set('gender', filters.gender)
      if (filters.maritalStatus) params.set('maritalStatus', filters.maritalStatus)
      if (filters.educationLevelId) params.set('educationLevelId', filters.educationLevelId)
      if (filters.occupationId) params.set('occupationId', filters.occupationId)
      if (filters.minAge) params.set('minAge', filters.minAge)
      if (filters.maxAge) params.set('maxAge', filters.maxAge)
      if (filters.matrimonyAvailable) params.set('matrimonyAvailable', 'true')
      params.set('page', String(targetPage))
      params.set('pageSize', String(PAGE_SIZE))

      const found = await api.get<MemberResult[]>(`/members/search?${params.toString()}`)
      setResults(found)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Community directory</h1>
        <form onSubmit={(e) => search(e, 1)} className="card stack" style={{ marginTop: 16 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="Search by name…"
              style={{ flex: 2, minWidth: 180 }}
              autoFocus
            />
            <input value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} placeholder="City" style={{ flex: 1, minWidth: 120 }} />
            <input value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} placeholder="State" style={{ flex: 1, minWidth: 120 }} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select value={filters.gender} onChange={(e) => setFilters({ ...filters, gender: e.target.value })}>
              <option value="">Any gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
            <select value={filters.maritalStatus} onChange={(e) => setFilters({ ...filters, maritalStatus: e.target.value })}>
              <option value="">Any marital status</option>
              <option value="UNMARRIED">Unmarried</option>
              <option value="MARRIED">Married</option>
              <option value="WIDOWED">Widowed</option>
              <option value="DIVORCED">Divorced</option>
            </select>
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
          </div>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="number" value={filters.minAge} onChange={(e) => setFilters({ ...filters, minAge: e.target.value })} placeholder="Min age" style={{ width: 100 }} />
            <input type="number" value={filters.maxAge} onChange={(e) => setFilters({ ...filters, maxAge: e.target.value })} placeholder="Max age" style={{ width: 100 }} />
            <label className="row" style={{ gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={filters.matrimonyAvailable} onChange={(e) => setFilters({ ...filters, matrimonyAvailable: e.target.checked })} />
              Matrimony available only
            </label>
            <button className="btn btn-primary" type="submit">Search</button>
          </div>
        </form>

        <ErrorBanner message={error} />

        <div className="stack" style={{ marginTop: 20 }}>
          {results?.length === 0 && <p className="muted">No members found.</p>}
          {results?.map((m) => (
            <Link key={m.id} href={`/members/${m.id}`} className="card row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
              <div className="row">
                <Avatar name={`${m.firstName} ${m.lastName ?? ''}`} deceased={m.status === 'DECEASED'} />
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {m.firstName} {m.lastName ?? ''}
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {[m.currentCity, m.education, m.occupation].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <StatusPill status={m.status} />
            </Link>
          ))}
        </div>

        {results && results.length > 0 && (
          <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <button className="btn btn-outline" disabled={page === 1} onClick={() => search(undefined, page - 1)}>
              Previous
            </button>
            <span className="muted">Page {page}</span>
            <button className="btn btn-outline" disabled={results.length < PAGE_SIZE} onClick={() => search(undefined, page + 1)}>
              Next
            </button>
          </div>
        )}
      </Shell>
    </RequireAuth>
  )
}
