'use client'

import { useId, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import { useT } from '../../lib/i18n'
import { AuthFrame, DevCode, OtpInput, TextField, cleanEmail, codeSendError } from '../../components/auth-ui'
import { ErrorBanner } from '../../components/ui'

/** Forgot password: a code to the account's email, then a new password. */
export default function ForgotPasswordPage() {
  const t = useT()
  const router = useRouter()
  const sentId = useId()
  const [identifier, setIdentifier] = useState('')
  const [sent, setSent] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const email = cleanEmail(identifier)
    if (!email) {
      setErrors({ identifier: t('validation.email') })
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const reply = await api.postFull<{ sent: boolean }>('/auth/password/forgot', { identifier: email })
      setIdentifier(email)
      setDevCode(reply.devOtp ?? null)
      setSent(true)
    } catch (err) {
      setError(codeSendError(err, t))
    } finally {
      setBusy(false)
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const next: Record<string, string> = {}
    if (!/^\d{6}$/.test(otp)) next.otp = t('validation.otp')
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) next.password = t('validation.passwordRule')
    if (confirm !== password) next.confirm = t('validation.passwordMatch')
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await api.post('/auth/password/reset', { identifier: identifier.trim(), otp, password })
      router.push('/sign-in?reset=1')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title={t('forgot.title')}
      lead={sent ? t('forgot.sentLead') : t('forgot.lead')}
      footer={
        <p>
          <Link href="/sign-in">{t('forgot.back')}</Link>
        </p>
      }
    >
      <ErrorBanner message={error} />
      {!sent ? (
        <form onSubmit={sendCode} noValidate>
          <TextField
            label={t('field.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            error={errors.identifier}
            autoFocus
          />
          <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
            {t('signIn.sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={reset} noValidate>
          <p className="k-hint" id={sentId}>
            {t('signIn.checkSpam')}
          </p>
          <DevCode code={devCode} />
          <OtpInput label={t('field.otp')} describedBy={sentId} error={errors.otp} onChange={setOtp} autoFocus />
          <TextField
            label={t('field.newPassword')}
            hint={t('field.passwordHint')}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <TextField label={t('field.confirmPassword')} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
            {t('forgot.submit')}
          </button>
          <p className="lw-auth__links">
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setSent(false)}>
              {t('forgot.again')}
            </button>
          </p>
        </form>
      )}
    </AuthFrame>
  )
}
