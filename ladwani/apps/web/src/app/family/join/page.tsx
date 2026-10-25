'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

interface FamilySearchResult {
  id: string
  name: string
  registrationNumber: string
  nativeVillage: string | null
}

interface FamilyMemberOption {
  id: string
  firstName: string
  lastName: string | null
}

interface RelationshipType {
  code: string
  label: string
}

export default function JoinFamilyPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FamilySearchResult[]>([])
  const [selected, setSelected] = useState<FamilySearchResult | null>(null)
  const [members, setMembers] = useState<FamilyMemberOption[]>([])
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipType[]>([])
  const [relatedToMemberId, setRelatedToMemberId] = useState('')
  const [relationshipTypeCode, setRelationshipTypeCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    api.get<RelationshipType[]>('/relationship-types').then(setRelationshipTypes).catch(() => undefined)
  }, [])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const found = await api.get<FamilySearchResult[]>(`/families/search?q=${encodeURIComponent(query)}`)
      setResults(found)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function selectFamily(family: FamilySearchResult) {
    setSelected(family)
    try {
      const detail = await api.get<{ members: FamilyMemberOption[] }>(`/families/${family.id}`)
      setMembers(detail.members)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setError(null)
    setSubmitting(true)
    try {
      await api.post(`/families/${selected.id}/join-requests`, { relatedToMemberId, relationshipTypeCode })
      setSubmitted(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <RequireAuth>
        <TopBar />
        <Shell>
          <div className="card stack">
            <h3>Join request sent</h3>
            <p className="muted">The family&apos;s Karta has been notified. You&apos;ll be added once they approve.</p>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => router.push('/dashboard')}>
              Back to dashboard
            </button>
          </div>
        </Shell>
      </RequireAuth>
    )
  }

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Find your family</h1>
        <form onSubmit={search} className="row" style={{ marginTop: 16 }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Family name or registration number" style={{ flex: 1 }} autoFocus />
          <button className="btn btn-primary" type="submit">
            Search
          </button>
        </form>

        <ErrorBanner message={error} />

        {!selected && (
          <div className="stack" style={{ marginTop: 20 }}>
            {results.map((f) => (
              <button
                key={f.id}
                className="card row"
                style={{ justifyContent: 'space-between', textAlign: 'left', border: '1px solid var(--border)' }}
                onClick={() => selectFamily(f)}
              >
                <div>
                  <h3 style={{ marginBottom: 4 }}>{f.name}</h3>
                  <p className="muted mono" style={{ margin: 0, fontSize: 13 }}>
                    {f.registrationNumber} {f.nativeVillage && `· ${f.nativeVillage}`}
                  </p>
                </div>
                <span className="btn btn-outline">Select</span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <form onSubmit={submit} className="card stack" style={{ marginTop: 20 }}>
            <h3>Joining {selected.name}</h3>
            <div className="field">
              <label htmlFor="relatedTo">How are you related?</label>
              <select id="relatedTo" value={relatedToMemberId} onChange={(e) => setRelatedToMemberId(e.target.value)} required>
                <option value="">Select a family member you&apos;re related to…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.firstName} {m.lastName ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="relType">Your relationship to them</label>
              <select id="relType" value={relationshipTypeCode} onChange={(e) => setRelationshipTypeCode(e.target.value)} required>
                <option value="">Select…</option>
                {relationshipTypes.map((rt) => (
                  <option key={rt.code} value={rt.code}>
                    {rt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <button type="button" className="btn btn-outline" onClick={() => setSelected(null)}>
                Choose a different family
              </button>
              <button className="btn btn-accent" type="submit" disabled={submitting}>
                {submitting ? 'Sending…' : 'Send join request'}
              </button>
            </div>
          </form>
        )}
      </Shell>
    </RequireAuth>
  )
}
