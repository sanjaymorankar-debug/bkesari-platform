'use client'

/**
 * The Kesari runtime (window.Kesari), served by the bkesari hub at
 * /kesari-ui/1.0.0/kesari.js and loaded in <head> by app/layout.tsx. Under
 * `next dev` on its own it is absent, so every use here has a plain fallback.
 */
export type KesariLang = 'en' | 'mr' | 'hi'

export interface KesariRuntime {
  currentLang(): KesariLang
  setLang(lang: string): Promise<string>
  formatDate(input: Date | string | number): string
  formatTime(input: Date | string | number): string
  formatDateTime(input: Date | string | number): string
  formatNumber(n: number, opts?: Intl.NumberFormatOptions): string
  formatRupees(n: number): string
  toast(message: string, opts?: { kind?: '' | 'success' | 'danger'; action?: string; onAction?: () => void; timeout?: number }): HTMLElement | null
  openDialog(dialog: HTMLDialogElement, opener?: Element | null): void
  wireOtp(box: HTMLElement): void
}

declare global {
  interface Window {
    Kesari?: KesariRuntime
  }
}

export function kesari(): KesariRuntime | undefined {
  return typeof window === 'undefined' ? undefined : window.Kesari
}

export function toast(message: string, kind: '' | 'success' | 'danger' = ''): void {
  kesari()?.toast(message, { kind })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "3 Nov 2026" (IST), Kesari's format, with the same fallback when it is absent. */
export function formatDate(input: Date | string | number): string {
  const k = kesari()
  if (k) return k.formatDate(input)
  const d = new Date(new Date(input).getTime() + 330 * 60_000)
  return Number.isNaN(d.getTime()) ? '' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Indian digit grouping: 130000 -> "1,30,000". */
export function formatNumber(n: number): string {
  return kesari()?.formatNumber(n) ?? new Intl.NumberFormat('en-IN').format(n)
}
