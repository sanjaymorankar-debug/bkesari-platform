import type { VisibilityLevel } from '@community-platform/shared-types'

export interface VisibilityViewer {
  isAuthenticated: boolean
  userId?: string
  areaIds?: string[]
  familyIds?: string[]
  roles?: string[]
}

export interface VisibilityOwner {
  userId?: string | null
  areaIds?: string[]
  familyIds?: string[]
  /** Areas an Operator must be scoped to in order to see this owner's ADMIN_OPERATOR fields. */
  operatorAreaIds?: string[]
}

/**
 * Implements the resolution algorithm in docs/09-privacy-architecture.md §3.
 * Pure function — no I/O — so callers resolve viewer/owner context first
 * (areas, family membership, roles) and this only ever answers yes/no.
 */
export function canView(level: VisibilityLevel, viewer: VisibilityViewer, owner: VisibilityOwner): boolean {
  switch (level) {
    case 'PUBLIC':
      return true

    case 'REGISTERED_COMMUNITY':
      return viewer.isAuthenticated

    case 'SAME_AREA':
      if (!viewer.isAuthenticated) return false
      return (viewer.areaIds ?? []).some((a) => (owner.areaIds ?? []).includes(a))

    case 'SAME_FAMILY':
      if (!viewer.isAuthenticated) return false
      return (viewer.familyIds ?? []).some((f) => (owner.familyIds ?? []).includes(f))

    case 'MATRIMONY_ONLY':
      // Delegated to the matrimony module's own view-context rules (M2). The base
      // resolver deliberately returns false so a generic caller never accidentally
      // exposes a matrimony-only field without an explicit matrimony-aware check.
      return false

    case 'ADMIN_OPERATOR':
      if (!viewer.isAuthenticated) return false
      if ((viewer.roles ?? []).includes('ADMIN')) return true
      if ((viewer.roles ?? []).includes('OPERATOR')) {
        return (owner.operatorAreaIds ?? []).some((a) => (viewer.areaIds ?? []).includes(a))
      }
      return false

    case 'PRIVATE':
      if (!viewer.isAuthenticated) return false
      return viewer.userId != null && viewer.userId === owner.userId

    default:
      return false
  }
}

/**
 * Filters a record down to only the fields the viewer is allowed to see.
 * A field with no declared visibility rule is omitted, never leaked by default
 * (docs/09-privacy-architecture.md §3 step 10).
 */
export function filterFields<T extends Record<string, unknown>>(
  record: T,
  fieldVisibility: Partial<Record<keyof T, VisibilityLevel>>,
  viewer: VisibilityViewer,
  owner: VisibilityOwner,
): Partial<T> {
  const result: Partial<T> = {}
  for (const key of Object.keys(record) as (keyof T)[]) {
    const level = fieldVisibility[key]
    if (!level) continue
    if (canView(level, viewer, owner)) {
      result[key] = record[key]
    }
  }
  return result
}
