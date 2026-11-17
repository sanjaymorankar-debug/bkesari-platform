'use client'

import { hasMessage, type Translate } from './i18n'

/** The same list as the API's (packages/shared-types MARITAL_STATUSES). */
export const MARITAL_STATUSES = ['UNMARRIED', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED', 'NOT_STATED'] as const
/** The same list as the API's (packages/shared-types INCOME_RANGES). */
export const INCOME_RANGES = ['BELOW_2L', 'L2_5L', 'L5_10L', 'L10_25L', 'ABOVE_25L', 'NOT_DISCLOSED'] as const

/** A code from the API in words, for one that has no translation yet: "member.id_proof" -> "Member id proof". */
export function humanize(code: string): string {
  const words = code
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function label(t: Translate, prefix: string, code: string | null | undefined): string {
  if (!code) return ''
  const key = `${prefix}.${code}`
  return hasMessage(key) ? t(key) : humanize(code)
}

/** "son" -> "Son" / "मुलगा". */
export const relationLabel = (t: Translate, code: string | null | undefined) => label(t, 'relation', code)
/** "MARRIED" -> "Married" / "विवाहित". */
export const maritalLabel = (t: Translate, code: string | null | undefined) => label(t, 'marital', code)
/** "MALE" -> "Man". */
export const genderLabel = (t: Translate, code: string | null | undefined) => label(t, 'gender', code)
/** "L5_10L" -> "₹5–10 lakh". */
export const incomeLabel = (t: Translate, code: string | null | undefined) => label(t, 'income', code)
/** "AADHAAR_MASKED" -> "Aadhaar (masked)". */
export const idProofLabel = (t: Translate, code: string | null | undefined) => label(t, 'idProof', code)

/** "Ramesh Ladwani": first and last name, as the API sends them. */
export function personName(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  return p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : ''
}
