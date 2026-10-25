'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import { ErrorBanner } from '../../components/ui'

export default function RegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState<'REGISTER' | 'VERIFY'>('REGISTER')
  const [form, setForm] = useState({ firstName: '', lastName: '', mobile: '', email: '', password: '' })
  const [userId, setUserId] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const result = await api.post<{ userId: string; message: string }>('/auth/register', {
        ...form,
        email: form.email || undefined,
      })
      setUserId(result.userId)
      setStep('VERIFY')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/auth/verify-otp', { userId, otp })
      router.push('/login')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'VERIFY') {
    return (
      <div className="shell" style={{ maxWidth: 420, paddingTop: 80 }}>
        <h1>Verify your mobile</h1>
        <p className="muted">Enter the 6-digit code we sent to {form.mobile}.</p>
        <form onSubmit={handleVerify} className="card stack" style={{ marginTop: 24 }}>
          <ErrorBanner message={error} />
          <div className="field">
            <label htmlFor="otp">OTP</label>
            <input id="otp" value={otp} onChange={(e) => setOtp(e.target.value)} required autoFocus maxLength={6} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? 'Verifying…' : 'Verify & continue'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="shell" style={{ maxWidth: 420, paddingTop: 80 }}>
      <h1>Join Mi Samaj</h1>
      <p className="muted">Create your account to register or join your family.</p>
      <form onSubmit={handleRegister} className="card stack" style={{ marginTop: 24 }}>
        <ErrorBanner message={error} />
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="firstName">First name</label>
            <input id="firstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required autoFocus />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="lastName">Last name</label>
            <input id="lastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="mobile">Mobile number</label>
          <input id="mobile" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} required placeholder="9876543210" />
        </div>
        <div className="field">
          <label htmlFor="email">Email (optional)</label>
          <input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="muted" style={{ marginTop: 16 }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </div>
  )
}
