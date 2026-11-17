'use client'

import { ApiError } from './api-client'
import { errorMessage } from './auth-context'
import type { Translate } from './i18n'

/**
 * What to tell someone when a request fails, in their language: busy (429),
 * our fault (5xx), gone (404) or no connection, else the API's own sentence
 * (a validation message that says what to change).
 */
export function errorText(err: unknown, t: Translate): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('common.errorBusy')
    if (err.status >= 500) return t('common.errorServer')
    if (err.status === 404) return t('common.errorNotFound')
    return errorMessage(err)
  }
  return t('common.errorNetwork')
}
