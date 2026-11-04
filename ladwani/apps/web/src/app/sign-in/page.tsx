'use client'

import { useEffect, useId, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useAuth, errorMessage, type CodeTarget } from '../../lib/auth-context'
import { api, BASE_PATH } from '../../lib/api-client'
import { useT } from '../../lib/i18n'
import { AuthFrame, DevCode, OtpInput, Tabs, TextField, cleanEmail, cleanMobile, codeSendError, tabPanelProps, useCountdown } from '../../components/auth-ui'
import { ErrorBanner, safeNext } from '../../components/ui'
import { toast } from '../../lib/kesari'

/** Codes go by email; by SMS only once the API has an SMS provider (smsLive), which it has not while SMS is on hold. */
type Method = 'email' | 'sms' | 'password'
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
  const { user, loading, smsLive } = useAuth()
  const tabsId = useId()
  const [method, setMethod] = useState<Method>('email')
  // The SMS tab exists only while the API has an SMS provider.
  const active: Method = method === 'sms' && !smsLive ? 'email' : method

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
      <Tabs<Method>
        id={tabsId}
        label={t('signIn.methods')}
        active={active}
        onChange={setMethod}
        tabs={[
          { key: 'email', label: t('signIn.tabEmail') },
          ...(smsLive ? [{ key: 'sms' as const, label: t('signIn.tabOtp') }] : []),
          { key: 'password', label: t('signIn.tabPassword') },
        ]}
      />
      {/* Each panel keeps its own state; switching tabs starts it afresh. */}
      {active === 'email' && (
        <div {...tabPanelProps(tabsId, 'email')}>
          <CodeSignIn channel="email" />
        </div>
      )}
      {active === 'sms' && (
        <div {...tabPanelProps(tabsId, 'sms')}>
          <CodeSignIn channel="sms" />
        </div>
      )}
      {active === 'password' && (
        <div {...tabPanelProps(tabsId, 'password')}>
          <PasswordSignIn />
        </div>
      )}
    </AuthFrame>
  )
}

/** A code by email (or SMS): the address first, then the 6 digits sent to it. */
function CodeSignIn({ channel }: { channel: 'email' | 'sms' }) {
  const t = useT()
  const { loginWithOtp } = useAuth()
  const byEmail = channel === 'email'
  const sentId = useId()
  const [address, setAddress] = useState('')
  const [addressError, setAddressError] = useState<string | null>(null)
  const [codeSent, setCodeSent] = useState(false)
  const [sentAt, setSentAt] = useState(0)
  const [otp, setOtp] = useState('')
  const [otpError, setOtpError] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [resendIn, setResendIn] = useCountdown()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const clean = (value: string) => (byEmail ? cleanEmail(value) : cleanMobile(value))
  const invalid = () => (byEmail ? t('validation.email') : t('validation.mobile'))
  const target = (value: string): CodeTarget => (byEmail ? { email: value } : { mobile: value })

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    const value = clean(address)
    if (!value) {
      setAddressError(invalid())
      return
    }
    setAddressError(null)
    setBusy(true)
    try {
      const reply = await api.postFull<{ sent: boolean }>('/auth/otp/send', target(value))
      setAddress(value)
      setDevCode(reply.devOtp ?? null)
      setCodeSent(true)
      setSentAt(Date.now())
      setOtp('')
      setOtpError(null)
      setResendIn(RESEND_SECONDS)
    } catch (err) {
      setError(codeSendError(err, t, channel))
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
      await loginWithOtp(target(address), otp)
      goTo(readNext())
    } catch (err) {
      setOtpError(errorMessage(err))
      setBusy(false)
    }
  }

  if (!codeSent) {
    return (
      <form onSubmit={sendCode} noValidate>
        <ErrorBanner message={error} />
        {byEmail ? (
          <TextField
            label={t('field.email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => address && setAddressError(clean(address) ? null : invalid())}
            error={addressError}
            autoFocus
          />
        ) : (
          <TextField
            label={t('field.mobile')}
            hint={t('field.mobileHint')}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => address && setAddressError(clean(address) ? null : invalid())}
            error={addressError}
            autoFocus
          />
        )}
        <button className="k-btn k-btn--block" type="submit" aria-busy={busy || undefined} disabled={busy}>
          {byEmail ? t('signIn.tabEmail') : t('signIn.sendCode')}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={verifyCode} noValidate>
      <ErrorBanner message={error} />
      <div id={sentId}>
        <p>{byEmail ? t('signIn.emailCodeSentTo', { email: address }) : t('signIn.codeSentTo', { mobile: address })}</p>
        {byEmail && <p className="k-hint">{t('signIn.checkSpam')}</p>}
      </div>
      <DevCode code={devCode} />
      <OtpInput key={sentAt} label={t('field.otp')} describedBy={sentId} error={otpError} onChange={setOtp} autoFocus />
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
            setError(null)
          }}
        >
          {byEmail ? t('signIn.changeEmail') : t('signIn.changeNumber')}
        </button>
      </div>
    </form>
  )
}

/** Email or mobile number + password. */
function PasswordSignIn() {
  const t = useT()
  const { login } = useAuth()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    <form onSubmit={signInWithPassword} noValidate>
      <ErrorBanner message={error} />
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
  )
}
