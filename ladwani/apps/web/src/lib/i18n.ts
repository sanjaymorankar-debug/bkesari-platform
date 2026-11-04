'use client'

import { useCallback, useSyncExternalStore } from 'react'
import en from '../i18n/en.json'
import mr from '../i18n/mr.json'
import hi from '../i18n/hi.json'
import type { KesariLang } from './kesari'

/**
 * LadWani's strings in English, Marathi and Hindi (src/i18n/*.json; English is
 * the source, scripts/check-i18n.js keeps the others key for key). English
 * unless the person chose another language with the app shell's switcher,
 * which every bkesari project shares: it saves the choice in localStorage
 * 'kesari.lang' and the cookie k_lang, and announces it with the `kesari:lang`
 * event. The browser's own language (navigator.language, Accept-Language) is
 * never used to choose.
 */
export type MessageKey = Exclude<keyof typeof en, '_meta'>
type Dict = Record<string, string | Record<string, string>>

const DICTS: Record<KesariLang, Dict> = { en, mr, hi }
const LANGS = Object.keys(DICTS) as KesariLang[]
const isLang = (value: unknown): value is KesariLang => LANGS.includes(value as KesariLang)

/**
 * The switcher's choice, in the shell's own order (portal/public/shared/menu.js):
 * the saved one, then the cookie, then English. Not Kesari.currentLang(),
 * which falls back to the browser's language.
 */
function readLang(): KesariLang {
  try {
    const saved = window.localStorage.getItem('kesari.lang')
    if (isLang(saved)) return saved
  } catch {
    // storage blocked (private window)
  }
  try {
    const cookie = /(?:^|;\s*)k_lang=(en|mr|hi)(?:;|$)/.exec(document.cookie)?.[1]
    if (isLang(cookie)) return cookie
  } catch {
    // no document.cookie (sandboxed frame)
  }
  return 'en'
}

function subscribe(onChange: () => void) {
  window.addEventListener('kesari:lang', onChange)
  return () => window.removeEventListener('kesari:lang', onChange)
}

/** The language being shown. English while the static page hydrates, then the person's. */
export function useLang(): KesariLang {
  return useSyncExternalStore(subscribe, readLang, () => 'en' as KesariLang)
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string

export function translate(lang: KesariLang, key: MessageKey, vars?: Record<string, string | number>): string {
  const own = DICTS[lang][key]
  const fallback = DICTS.en[key]
  let text = typeof own === 'string' ? own : typeof fallback === 'string' ? fallback : key
  if (vars) text = text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m))
  return text
}

/** t('auth.signIn') in the current language; re-renders when the shell changes it. */
export function useT(): Translate {
  const lang = useLang()
  return useCallback<Translate>((key, vars) => translate(lang, key, vars), [lang])
}

/** Whether a key exists, for codes from the API (statuses) that may have no translation. */
export function hasMessage(key: string): key is MessageKey {
  return typeof DICTS.en[key] === 'string'
}
