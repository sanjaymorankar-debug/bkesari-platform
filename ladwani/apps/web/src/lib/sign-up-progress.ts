'use client'

/**
 * Sign-up's progress on this device (localStorage 'ladwani.signup'), so a
 * person who closes the tab at step 3 comes back to step 3. It holds what they
 * typed, never a code or a password, and is removed when sign-up finishes.
 * Storage can be blocked (private windows): then progress is simply not kept.
 */
export interface SignUpProgress {
  step: 1 | 2 | 3 | 4
  firstName?: string
  lastName?: string
  email?: string
  mobile?: string
  gender?: string
  dateOfBirth?: string
  educationLevelId?: string
  occupationId?: string
  state?: string
  district?: string
  taluka?: string
  village?: string
  currentCity?: string
  idProofKind?: string
}

const KEY = 'ladwani.signup'

export function loadProgress(): SignUpProgress | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SignUpProgress
    return parsed && [1, 2, 3, 4].includes(parsed.step) ? parsed : null
  } catch {
    return null
  }
}

export function saveProgress(progress: SignUpProgress): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(progress))
  } catch {
    // blocked: sign-up still works, it just will not resume
  }
}

export function clearProgress(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // blocked
  }
}
