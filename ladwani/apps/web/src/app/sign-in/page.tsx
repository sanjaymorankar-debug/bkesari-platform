'use client'

import { useEffect, useId, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useAuth, errorMessage } from '../../lib/auth-context'
import { api, BASE_PATH } from '../../lib/api-client'
import { useT } from '../../lib/i18n'
import { AuthFrame, DevCode, OtpInput, Tabs, TextField, cleanMobile, tabPanelProps, useCountdown } from '../../components/auth-ui'
import { ErrorBanner, safeNext } from '../../components/ui'
import { toast } from '../../lib/kesari'

type Method = 'otp' | 'password'
const RESEND_SECONDS = 30

function readNext(): string {
  try {
    return safeNext(new URLSearchParams(window.location.search).get('next'))
  } catch {
    return '/dashboard'
  }
}

/** A full load, so the bkesari app shell's account menu shows the new session. */
function goTo(path: string) {
  window.location.assign(`${BASE_PATH}${path}`)
}

export default function SignInPage() {
  const t = useT()
  const { user, loading, login, loginWithOtp } = useAuth()
  const tabsId = useId()
  const [method, setMethod] = useState<Method>('otp')

  // OTP
  const [mobile, setMobile] = useState('')
  const [mobileError, setMobileError] = useState<string | null>(null)
  const [codeSent, setCodeSent] = useState(false)
  const [sentAt, setSentAt] = useState(0)
  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [resendIn, setResendIn] = useCountdown()

  // Password
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({})

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loading && user) goTo(readNext())
  }, [loading, user])

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('reset') === '1') toast(t('forgot.done'), 'success')
    } catch {
      // no query
    }
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    const clean = cleanMobile(mobile)
    if (!clean) {
      setMobileError(t('validation.mobile'))
      return
    }
    setMobileError(null)
    setBusy(true)
    try {
      const reply = await api.postFull<{ sent: boolean }>('/auth/otp/send', { mobile: clean })
      setMobile(clean)
      setDevCode(reply.devOtp ?? null)
      setCodeSent(true)
      setSentAt(Date.now())
      setOtp('')
      setOtpError(null)
      setResendIn(RESEND_SECONDS)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^\d{6}$/.test(otp)) {
      setOtpError(t('validation.otp'))
      return
    }
    setOtpError(null)
    setBusy(true)
    try {
      await loginWithOtp(mobile, otp)
      goTo(readNext())
    } catch (err) {
      setOtpError(errorMessage(err))
      setBusy(false)
    }
  }

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const errors: typeof fieldErrors = {}
    if (!identifier.trim()) errors.identifier = t('validation.identifier')
    if (!password) errors.password = t('validation.passwordRequired')
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    setBusy(true)
    try {
      await login(identifier.trim(), password)
      goTo(readNext())
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title={t('signIn.title')}
      lead={t('signIn.lead')}
      footer={
        <p>
          {t('signIn.newHere')} <Link href="/sign-up">{t('signIn.join')}</Link>
        </p>
      }
    >
      <Tabs
        id={tabsId}
        label={t('signIn.methods')}
        active={method}
        onChange={(m) => {
          setMethod(m)
          setError(null)
        }}
        tabs={[
          { key: 'otp', label: t('signIn.tabOtp') },
          { key: 'password', label: t('signIn.tabPassword') },
        ]}
      />
      <ErrorBanner message={error} />

      {method === 'otp' && (
        <div {...tabPanelProps(tabsId, 'otp')}>
          {!codeSent ? (
            <form onSubmit={sendCode} noValidate>
              <TextField
                label={t('field.mobile')}
                hint={t('field.mobileHint')}
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                onBlur={() => mobile && setMobileError(cleanMobile(mobile) ? null : t('validation.mobile'))}
                error={mobileError}
                autoFocus
              />
              <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
                {t('signIn.sendCode')}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} noValidate>
              <p>{t('signIn.codeSentTo', { mobile })}</p>
              <DevCode code={devCode} />
              <OtpInput key={sentAt} label={t('field.otp')} error={otpError} onChange={setOtp} autoFocus />
              <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
                {t('signIn.submit')}
              </button>
              <div className="k-row lw-auth__links">
                <button type="button" className="k-btn k-btn--ghost k-btn--sm" disabled={resendIn > 0 || busy} onClick={() => sendCode()}>
                  {resendIn > 0 ? t('signIn.resendIn', { seconds: resendIn }) : t('signIn.resend')}
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--ghost k-btn--sm"
                  onClick={() => {
                    setCodeSent(false)
                    setDevCode(null)
                  }}
                >
                  {t('signIn.changeNumber')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {method === 'password' && (
        <form {...tabPanelProps(tabsId, 'password')} onSubmit={signInWithPassword} noValidate>
          <TextField
            label={t('field.identifier')}
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            error={fieldErrors.identifier}
            autoFocus
          />
          <TextField
            label={t('field.password')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />
          <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
            {t('signIn.submit')}
          </button>
          <p className="lw-auth__links">
            <Link href="/forgot-password">{t('signIn.forgot')}</Link>
          </p>
        </form>
      )}
    </AuthFrame>
  )
}
