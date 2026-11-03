import './globals.css'
import { AuthProvider } from '../lib/auth-context'

/**
 * Kesari, the bkesari design system, served by the hub on the same origin:
 * tokens, base styles and components (kesari.css, with the Mukta and Tiro
 * Devanagari Marathi fonts), and the runtime (kesari.js: theme, language, OTP
 * boxes, toasts, dialogs). Pinned to a version, like every project's copy.
 * Under `next dev` on its own these do not exist; the app still works, plainly.
 */
const KESARI = '/kesari-ui/1.0.0'
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export const metadata = {
  title: 'LadWani',
  description: 'Family trees and community, for every village. A bkesari.com project.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#7C2D12',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-project gives LadWani its maroon accent. kesari.js sets lang and
    // data-theme on <html> before React hydrates, hence suppressHydrationWarning.
    <html lang="en" data-project="ladwani" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-css-tags -- the shared design system, served by the hub, not part of this build */}
        <link rel="stylesheet" href={`${KESARI}/kesari.css`} />
        {/* Not deferred: it applies the saved theme before the first paint. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- must run before the body renders */}
        <script src={`${KESARI}/kesari.js`} />
      </head>
      <body>
        {/* The bkesari app shell (/shared/menu.js) fills these two slots in the
            browser. React leaves their contents alone: empty innerHTML of its own. */}
        <div data-bkesari-menu="" data-me-url={`${BASE}/api/v1/auth/session`} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: '' }} />
        <AuthProvider>{children}</AuthProvider>
        <div data-kesari-footer="" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: '' }} />
        <script src="/shared/menu.js" defer />
      </body>
    </html>
  )
}
