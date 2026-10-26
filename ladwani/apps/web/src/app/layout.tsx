import localFont from 'next/font/local'
import './globals.css'
import { AuthProvider } from '../lib/auth-context'

// The fonts ship with the app (./fonts, latin subset, from Fontsource; SIL OFL
// 1.1, licences beside them). next/font/google fetched them from Google at
// build time, and a failed fetch failed the whole build, on CI and on Hostinger.
const fraunces = localFont({
  src: [
    { path: './fonts/fraunces-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/fraunces-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/fraunces-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-display',
})
const workSans = localFont({
  src: [
    { path: './fonts/work-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/work-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/work-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-body',
})
const plexMono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-mono',
})

export const metadata = {
  title: 'Mi Samaj',
  description: 'Community + Family + Trust',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${workSans.variable} ${plexMono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
