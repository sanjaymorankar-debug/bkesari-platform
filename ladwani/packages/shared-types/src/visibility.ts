/** Field-level visibility levels — see docs/09-privacy-architecture.md */
export const VISIBILITY_LEVELS = [
  'PUBLIC',
  'REGISTERED_COMMUNITY',
  'SAME_AREA',
  'SAME_FAMILY',
  'MATRIMONY_ONLY',
  'ADMIN_OPERATOR',
  'PRIVATE',
] as const
export type VisibilityLevel = (typeof VISIBILITY_LEVELS)[number]

export const DEFAULT_FIELD_VISIBILITY: Record<string, VisibilityLevel> = {
  mobile: 'PRIVATE',
  alternateMobile: 'PRIVATE',
  email: 'PRIVATE',
  currentAddressLine: 'PRIVATE',
  currentCity: 'REGISTERED_COMMUNITY',
  currentState: 'REGISTERED_COMMUNITY',
  nativeVillage: 'REGISTERED_COMMUNITY',
  incomeRange: 'PRIVATE',
  education: 'REGISTERED_COMMUNITY',
  occupation: 'REGISTERED_COMMUNITY',
  photos: 'REGISTERED_COMMUNITY',
  dateOfBirth: 'SAME_FAMILY',
  age: 'REGISTERED_COMMUNITY',
  maritalStatus: 'REGISTERED_COMMUNITY',
  bio: 'REGISTERED_COMMUNITY',
  employerOrBusiness: 'REGISTERED_COMMUNITY',
  skills: 'REGISTERED_COMMUNITY',
}

/** Fields the profile owner is never allowed to raise/lower — always PRIVATE regardless of override. */
export const NON_CONFIGURABLE_FIELDS = new Set<string>([])
