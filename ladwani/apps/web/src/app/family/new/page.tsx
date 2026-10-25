'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

interface DuplicateMatch {
  id: string
  reason: string
}

export default function NewFamilyPage() {
  const router = useRouter()
  const [form, setForm] = useState({ name: '', surname: '', nativeVillage: '', nativeDistrict: '', nativeState: '' })
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(acknowledgedDuplicates: boolean) {
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/families', { ...form, acknowledgedDuplicates })
      router.push('/dashboard')
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

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Register a new family</h1>
        <p className="muted">This goes to an Operator for verification before it becomes active.</p>

        {duplicates && duplicates.length > 0 ? (
          <div className="card stack" style={{ marginTop: 24, borderColor: 'var(--warning)' }}>
            <h3>Possible duplicate found</h3>
            <p className="muted">These existing families look similar to what you entered. Please double check before continuing.</p>
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
            style={{ marginTop: 24 }}
            onSubmit={(e) => {
              e.preventDefault()
              submit(false)
            }}
          >
            <ErrorBanner message={error} />
            <div className="field">
              <label htmlFor="name">Family name</label>
              <input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="surname">Surname</label>
              <input id="surname" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} />
            </div>
            <div className="row">
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="nativeVillage">Native village</label>
                <input id="nativeVillage" value={form.nativeVillage} onChange={(e) => setForm({ ...form, nativeVillage: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="nativeDistrict">District</label>
                <input id="nativeDistrict" value={form.nativeDistrict} onChange={(e) => setForm({ ...form, nativeDistrict: e.target.value })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="nativeState">State</label>
                <input id="nativeState" value={form.nativeState} onChange={(e) => setForm({ ...form, nativeState: e.target.value })} />
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Checking…' : 'Submit for verification'}
            </button>
          </form>
        )}
      </Shell>
    </RequireAuth>
  )
}
