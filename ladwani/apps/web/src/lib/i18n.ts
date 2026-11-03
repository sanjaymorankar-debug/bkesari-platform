'use client'

import { useCallback, useSyncExternalStore } from 'react'
import en from '../i18n/en.json'
import mr from '../i18n/mr.json'
import hi from '../i18n/hi.json'
import { kesari, type KesariLang } from './kesari'

/**
 * LadWani's strings in English, Marathi and Hindi (src/i18n/*.json; English is
 * the source, scripts/check-i18n.js keeps the others key for key). The language
 * is Kesari's, chosen in the app shell and shared by every bkesari project:
 * window.Kesari.currentLang(), announced by the `kesari:lang` event.
 */
export type MessageKey = Exclude<keyof typeof en, '_meta'>
type Dict = Record<string, string | Record<string, string>>

const DICTS: Record<KesariLang, Dict> = { en, mr, hi }
const LANGS = Object.keys(DICTS) as KesariLang[]

function readLang(): KesariLang {
  try {
    const lang = kesari()?.currentLang()
    if (lang && LANGS.includes(lang)) return lang
  } catch {
    // the runtime failed; fall through to the stored choice
  }
  try {
    const saved = window.localStorage.getItem('kesari.lang') as KesariLang | null
    if (saved && LANGS.includes(saved)) return saved
  } catch {
    // storage blocked (private window)
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
