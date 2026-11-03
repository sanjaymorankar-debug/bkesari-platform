'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api, BASE_PATH } from '../../lib/api-client'
import { errorMessage, useAuth } from '../../lib/auth-context'
import { useT } from '../../lib/i18n'
import { loadProgress } from '../../lib/sign-up-progress'
import { AuthFrame, DevCode, OtpInput, TextField, cleanMobile, useCountdown } from '../../components/auth-ui'
import { ErrorBanner } from '../../components/ui'

/**
 * Verify a mobile after registering: for someone who created an account and
 * left before entering the code. A new code signs them in and activates it.
 */
export default function VerifyPage() {
  const t = useT()
  const { loginWithOtp } = useAuth()
  const [mobile, setMobile] = useState('')
  const [sentAt, setSentAt] = useState(0)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useCountdown()

  useEffect(() => {
    let known = loadProgress()?.mobile ?? ''
    try {
      known = cleanMobile(new URLSearchParams(window.location.search).get('mobile') ?? '') || known
    } catch {
      // no query
    }
    setMobile(known)
  }, [])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    const clean = cleanMobile(mobile)
    if (!clean) {
      setErrors({ mobile: t('validation.mobile') })
      return
    }
    setErrors({})
    setBusy(true)
    try {
      const reply = await api.postFull<{ sent: boolean }>('/auth/otp/send', { mobile: clean })
      setMobile(clean)
      setDevCode(reply.devOtp ?? null)
      setSentAt(Date.now())
      setResendIn(30)
    } catch (err) {
      setError(errorMessage(err))
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
      await loginWithOtp(mobile, otp)
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
            label={t('field.mobile')}
            hint={t('field.mobileHint')}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            error={errors.mobile}
            autoFocus
          />
          <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
            {t('signIn.sendCode')}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate>
          <p>{t('signIn.codeSentTo', { mobile })}</p>
          <DevCode code={devCode} />
          <OtpInput key={sentAt} label={t('field.otp')} error={errors.otp} onChange={setOtp} autoFocus />
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
