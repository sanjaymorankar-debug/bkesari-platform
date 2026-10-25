'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api, ApiError } from '../../../../../lib/api-client'
import { errorMessage } from '../../../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../../../components/ui'

interface FamilyMemberOption {
  id: string
  firstName: string
  lastName: string | null
}

interface RelationshipType {
  code: string
  label: string
}

interface DuplicateMatch {
  id: string
  reason: string
}

export default function AddMemberPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [members, setMembers] = useState<FamilyMemberOption[]>([])
  const [relationshipTypes, setRelationshipTypes] = useState<RelationshipType[]>([])
  const [relatedToMemberId, setRelatedToMemberId] = useState('')
  const [relationshipTypeCode, setRelationshipTypeCode] = useState('')
  const [memberData, setMemberData] = useState({ firstName: '', lastName: '', gender: '', currentCity: '' })
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    api.get<{ members: FamilyMemberOption[] }>(`/families/${id}`).then((f) => setMembers(f.members))
    api.get<RelationshipType[]>('/relationship-types').then(setRelationshipTypes)
  }, [id])

  async function submit(acknowledgedDuplicates: boolean) {
    setError(null)
    setSubmitting(true)
    try {
      await api.post(`/families/${id}/members`, {
        relatedToMemberId,
        relationshipTypeCode,
        memberData: { ...memberData, gender: memberData.gender || undefined, lastName: memberData.lastName || undefined },
        acknowledgedDuplicates,
      })
      setSubmitted(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as { duplicates?: DuplicateMatch[] })?.duplicates) {
        setDuplicates((err.body as { duplicates: DuplicateMatch[] }).duplicates)
      } else {
        setError(errorMessage(err))
      }
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
            <h3>Submitted for Operator review</h3>
            <p className="muted">This new member will appear in the family once an Operator verifies the addition.</p>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => router.push(`/family/${id}`)}>
              Back to family
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
        <h1>Add a family member</h1>

        {duplicates && duplicates.length > 0 ? (
          <div className="card stack" style={{ marginTop: 20, borderColor: 'var(--warning)' }}>
            <h3>Possible duplicate found</h3>
            <ul>
              {duplicates.map((d) => (
                <li key={d.id}>{d.reason}</li>
              ))}
            </ul>
            <div className="row">
              <button className="btn btn-outline" onClick={() => setDuplicates(null)}>
                Go back and edit
              </button>
              <button className="btn btn-accent" onClick={() => submit(true)} disabled={submitting}>
                {submitting ? 'Submitting…' : "It's not a duplicate — continue anyway"}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="card stack"
            style={{ marginTop: 20 }}
            onSubmit={(e) => {
              e.preventDefault()
              submit(false)
            }}
          >
            <ErrorBanner message={error} />
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="firstName">First name</label>
                <input
                  id="firstName"
                  value={memberData.firstName}
                  onChange={(e) => setMemberData({ ...memberData, firstName: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="lastName">Last name</label>
                <input id="lastName" value={memberData.lastName} onChange={(e) => setMemberData({ ...memberData, lastName: e.target.value })} />
              </div>
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="gender">Gender</label>
                <select id="gender" value={memberData.gender} onChange={(e) => setMemberData({ ...memberData, gender: e.target.value })}>
                  <option value="">Not stated</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="currentCity">Current city</label>
                <input id="currentCity" value={memberData.currentCity} onChange={(e) => setMemberData({ ...memberData, currentCity: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="relatedTo">Related to</label>
              <select id="relatedTo" value={relatedToMemberId} onChange={(e) => setRelatedToMemberId(e.target.value)} required>
                <option value="">Select an existing family member…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.firstName} {m.lastName ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="relType">New member&apos;s relationship to them</label>
              <select id="relType" value={relationshipTypeCode} onChange={(e) => setRelationshipTypeCode(e.target.value)} required>
                <option value="">Select…</option>
                {relationshipTypes.map((rt) => (
                  <option key={rt.code} value={rt.code}>
                    {rt.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Checking…' : 'Submit for review'}
            </button>
          </form>
        )}
      </Shell>
    </RequireAuth>
  )
}
