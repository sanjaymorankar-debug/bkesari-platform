'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, errorMessage } from '../../lib/auth-context'
import { ErrorBanner } from '../../components/ui'

export default function LoginPage() {
  const { login } = useAuth()
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(identifier, password)
      router.push('/dashboard')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="shell" style={{ maxWidth: 420, paddingTop: 80 }}>
      <h1>Mi Samaj</h1>
      <p className="muted">Sign in to your community account.</p>
      <form onSubmit={handleSubmit} className="card stack" style={{ marginTop: 24 }}>
        <ErrorBanner message={error} />
        <div className="field">
          <label htmlFor="identifier">Mobile or email</label>
          <input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 16 }}>
        New here? <Link href="/register">Create an account</Link>
      </p>
    </div>
  )
}
