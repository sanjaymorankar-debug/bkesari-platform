'use client'

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import { kesari } from '../lib/kesari'

/**
 * The frame every sign-in screen shares: LadWani's name in its accent, and the
 * reminder that this account belongs to LadWani alone.
 */
export function AuthFrame({ title, lead, children, footer }: { title: string; lead?: string; children: ReactNode; footer?: ReactNode }) {
  const t = useT()
  return (
    <main id="main" className="k-main k-main--narrow lw-auth">
      <p className="lw-wordmark">{t('app.name')}</p>
      <h1>{title}</h1>
      {lead && <p className="k-lead">{lead}</p>}
      <p className="lw-separate">{t('auth.separateAccount')}</p>
      <div className="k-card lw-auth__card">{children}</div>
      {footer && <div className="lw-auth__footer">{footer}</div>}
    </main>
  )
}

/** A labelled input with its hint and inline error, wired for screen readers. */
export function TextField({
  label,
  hint,
  error,
  ...input
}: { label: string; hint?: string; error?: string | null } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className="k-field">
      <label className="k-label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <span className="k-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      <input id={id} className="k-input" aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
      <span className="k-error" id={`${id}-error`} role={error ? 'alert' : undefined}>
        {error ?? ''}
      </span>
    </div>
  )
}

/**
 * The 6-box code input: Kesari's k-otp (numeric keypad, paste and SMS autofill
 * fill every box), or one plain field when the runtime is not on the page.
 * The boxes are created by kesari.js after mount, never in the static HTML.
 */
export function OtpInput({ label, error, onChange, autoFocus }: { label: string; error?: string | null; onChange: (value: string) => void; autoFocus?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [fallback, setFallback] = useState(false)
  const id = useId()
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const el = box.current
    const runtime = kesari()
    if (!el || !runtime) {
      setFallback(true)
      return
    }
    el.dataset.kOtp = '6'
    runtime.wireOtp(el)
    const inputs = el.querySelectorAll('input:not([type=hidden])')
    inputs.forEach((input) => {
      if (error) input.setAttribute('aria-invalid', 'true')
      input.setAttribute('aria-describedby', `${id}-error`)
    })
    if (autoFocus) (inputs[0] as HTMLInputElement | undefined)?.focus()
    const listener = (e: Event) => changeRef.current((e as CustomEvent<{ value: string }>).detail.value)
    el.addEventListener('kesari:otp', listener)
    return () => el.removeEventListener('kesari:otp', listener)
    // wired once; error state is mirrored below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    box.current?.querySelectorAll('input:not([type=hidden])').forEach((input) => {
      if (error) input.setAttribute('aria-invalid', 'true')
      else input.removeAttribute('aria-invalid')
    })
  }, [error])

  return (
    <div className="k-field">
      <span className="k-label" id={`${id}-label`}>
        {label}
      </span>
      {fallback ? (
        <input
          className="k-input lw-otp-plain"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]*"
          aria-labelledby={`${id}-label`}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-error`}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      ) : (
        <div ref={box} className="k-otp" role="group" aria-labelledby={`${id}-label`} data-name="otp" />
      )}
      <span className="k-error" id={`${id}-error`} role={error ? 'alert' : undefined}>
        {error ?? ''}
      </span>
    </div>
  )
}

/** Accessible tabs (k-tabs): arrow keys move between them, as the ARIA pattern asks. */
export function Tabs<K extends string>({ id, tabs, active, onChange, label }: { id: string; tabs: { key: K; label: string }[]; active: K; onChange: (key: K) => void; label: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = tabs[(index + step + tabs.length) % tabs.length]
    onChange(next.key)
    refs.current[next.key]?.focus()
  }
  return (
    <div className="k-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => (
        <button
          key={tab.key}
          ref={(el) => {
            refs.current[tab.key] = el
          }}
          type="button"
          role="tab"
          id={`${id}-${tab.key}`}
          aria-selected={tab.key === active}
          aria-controls={`${id}-${tab.key}-panel`}
          tabIndex={tab.key === active ? 0 : -1}
          onClick={() => onChange(tab.key)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

/** The panel for tab `key` of the Tabs with this `id`. */
export function tabPanelProps(tabsId: string, key: string) {
  return { role: 'tabpanel', id: `${tabsId}-${key}-panel`, 'aria-labelledby': `${tabsId}-${key}`, tabIndex: 0 }
}

/** Shows the code the API hands back outside production (no SMS provider is wired yet). */
export function DevCode({ code }: { code?: string | null }) {
  const t = useT()
  if (!code) return null
  return (
    <div className="k-banner k-banner--warning" role="status">
      <p>{t('auth.devCode', { code })}</p>
    </div>
  )
}

/** A 10-digit Indian mobile, as the API wants it, from what people type. */
export function cleanMobile(value: string): string {
  const digits = value.replace(/[\s().-]/g, '')
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits)
  return m ? m[1] : ''
}

/** Seconds left before "Send the code again" is offered. */
export function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return
    const timer = window.setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [left])
  return [left, setLeft]
}
