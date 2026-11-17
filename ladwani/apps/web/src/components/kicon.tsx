import { KESARI_BASE } from '../lib/kesari'

/** The Kesari icon set (packages/kesari-ui/src/icons.json), drawn from the hub's sprite. */
export type KIconName =
  | 'home' | 'ladwani' | 'grid' | 'globe' | 'external' | 'arrow-left' | 'arrow-right' | 'chevron-down' | 'plus' | 'close' | 'check'
  | 'search' | 'user' | 'users' | 'sign-in' | 'lock' | 'shield' | 'pending' | 'alert' | 'info' | 'stop' | 'clock' | 'calendar'
  | 'mail' | 'phone' | 'map-pin' | 'heart' | 'book' | 'school'

/**
 * Decorative, like every Kesari icon: the text beside it, or the control's
 * aria-label, carries the meaning. Under `next dev` alone the sprite is not
 * served and the icon is simply blank.
 */
export function KIcon({ name, small, className }: { name: KIconName; small?: boolean; className?: string }) {
  const classes = ['k-icon', small && 'k-icon--sm', className].filter(Boolean).join(' ')
  return (
    <svg className={classes} aria-hidden="true" focusable="false">
      <use href={`${KESARI_BASE}/icons.svg#k-i-${name}`} />
    </svg>
  )
}

/** A project icon tile (k-picon) with LadWani's tree, or another icon from the set. */
export function PIcon({ name = 'ladwani', size }: { name?: KIconName; size?: 'sm' | 'lg' | 'xl' }) {
  return (
    <span className={`k-picon${size ? ` k-picon--${size}` : ''}`} aria-hidden="true">
      <KIcon name={name} />
    </span>
  )
}
