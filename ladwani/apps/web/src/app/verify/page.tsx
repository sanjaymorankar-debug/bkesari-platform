'use client'

import { useEffect, useId, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api, BASE_PATH } from '../../lib/api-client'
import { errorMessage, useAuth } from '../../lib/auth-context'
import { useT } from '../../lib/i18n'
import { loadProgress } from '../../lib/sign-up-progress'
import { AuthFrame, DevCode, OtpInput, TextField, cleanEmail, codeSendError, useCountdown } from '../../components/auth-ui'
import { ErrorBanner } from '../../components/ui'

/**
 * Verify an email after registering: for someone who created an account and
 * left before entering the code. A new code by email signs them in and
 * activates it.
 */
export default function VerifyPage() {
  const t = useT()
  const { loginWithOtp } = useAuth()
  const sentId = useId()
  const [email, setEmail] = useState('')
  const [sentAt, setSentAt] = useState(0)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useCountdown()

  useEffect(() => {
    let known = loadProgress()?.email ?? ''
    try {
      known = cleanEmail(new URLSearchParams(window.location.search).get('email') ?? '') || known
    } catch {
      // no query
    }
    setEmail(known)
  }, [])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    const clean = cleanEmail(email)
    if (!clean) {
      setErrors({ email: t('validation.email') })
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const reply = await api.postFull<{ sent: boolean }>('/auth/otp/send', { email: clean })
      setEmail(clean)
      setDevCode(reply.devOtp ?? null)
      setSentAt(Date.now())
      setResendIn(30)
    } catch (err) {
      setError(codeSendError(err, t))
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(otp)) {
      setErrors({ otp: t('validation.otp') })
      return
    }
    setErrors({})
    setBusy(true)
    try {
      await loginWithOtp({ email }, otp)
      // Back to sign-up if it was left part-way, else home.
      window.location.assign(`${BASE_PATH}${loadProgress() ? '/sign-up/' : '/dashboard/'}`)
    } catch (err) {
      setErrors({ otp: errorMessage(err) })
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title={t('verify.title')}
      lead={t('verify.lead')}
      footer={
        <p>
          <Link href="/sign-in">{t('forgot.back')}</Link>
        </p>
      }
    >
      <ErrorBanner message={error} />
      {!sentAt ? (
        <form onSubmit={send} noValidate>
          <TextField
            label={t('field.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            autoFocus
          />
          <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
            {t('signIn.tabEmail')}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate>
          <div id={sentId}>
            <p>{t('signIn.emailCodeSentTo', { email })}</p>
            <p className="k-hint">{t('signIn.checkSpam')}</p>
          </div>
          <DevCode code={devCode} />
          <OtpInput key={sentAt} label={t('field.otp')} describedBy={sentId} error={errors.otp} onChange={setOtp} autoFocus />
          <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
            {t('signUp.verify')}
          </button>
          <p className="lw-auth__links">
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={resendIn > 0 || busy} onClick={() => send()}>
              {resendIn > 0 ? t('signIn.resendIn', { seconds: resendIn }) : t('signIn.resend')}
            </button>
          </p>
        </form>
      )}
    </AuthFrame>
  )
}
