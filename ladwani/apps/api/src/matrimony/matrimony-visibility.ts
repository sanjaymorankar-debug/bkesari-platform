/**
 * Implements docs/09-privacy-architecture.md §3 step 7: "If level ==
 * MATRIMONY_ONLY → delegate to the matrimony module's own rule for the
 * current view context." Pure, side-effect-free — mirrors
 * common/privacy/visibility.ts's canView() design so it's independently
 * unit-testable without a database.
 *
 * Contact-detail reveal (mobile/email) is deliberately NOT decided here —
 * those fields default to PRIVATE, not MATRIMONY_ONLY, and are revealed to
 * one specific viewer only after a mutually-accepted CONTACT_REQUEST
 * interest (see MatrimonyService.getDetail), never as a blanket visibility
 * level change.
 */

export interface MatrimonyViewer {
  isAuthenticated: boolean
  userId?: string
}

export interface MatrimonyProfileOwner {
  userId?: string | null
  isVisible: boolean
}

export type MatrimonyViewContext = 'SEARCH' | 'DETAIL'

/**
 * Whether the viewer may see this profile's MATRIMONY_ONLY-tagged fields at
 * all. The same gate applies regardless of MatrimonyViewContext — a search
 * result's slimmer field set vs. a detail view's fuller set is a projection
 * decision made by the caller, not a difference in this gate.
 */
export function canViewMatrimonyProfile(viewer: MatrimonyViewer, owner: MatrimonyProfileOwner): boolean {
  if (!viewer.isAuthenticated) return false
  if (viewer.userId != null && viewer.userId === owner.userId) return true
  return owner.isVisible
}
