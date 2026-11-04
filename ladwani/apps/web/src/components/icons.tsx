/**
 * Line icons in the Lucide style (docs/20 §8): 24px grid, 1.8 stroke,
 * currentColor. Always decorative here: the link or button carries the label.
 */
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  family: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M17 11a3 3 0 1 0 0-6M22 21v-1a5 5 0 0 0-4-4.9',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  profile: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21a8 8 0 0 1 16 0',
  feed: 'M4 5h16v11H8l-4 4zM8 9h8M8 12h5',
  matrimony: 'M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM15 20a5 5 0 1 0 0-10 5 5 0 0 0 0 10z',
  services: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6',
  bookings: 'M4 6h16v15H4zM4 10h16M8 3v5M16 3v5',
  donations: 'M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z',
  approvals: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9',
  notifications: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0',
  fees: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  payments: 'M3 6h18v12H3zM3 10h18M7 15h3',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .5-1.5-1.5L17 5l-3-1-1 2h-2L10 4 7 5l.5 2L6 8.5 4 8l-1 3 2 1v0l-2 1 1 3 2-.5L7.5 17 7 19l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3z',
  audit: 'M8 3h8l4 4v14H4V3zM9 12h6M9 16h6',
  reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  signOut: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  tree: 'M12 3v6M12 9l-6 4M12 9l6 4M6 13v4M18 13v4M4 21h4M16 21h4',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  check: 'M5 12l5 5 9-10',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}
