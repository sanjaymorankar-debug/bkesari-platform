import localFont from 'next/font/local'
import './globals.css'
import { AuthProvider } from '../lib/auth-context'

// The fonts ship with the app (./fonts, from Fontsource 5.3.0; SIL OFL 1.1,
// licences beside them). next/font/google fetched them from Google at build
// time, and a failed fetch failed the whole build, on CI and on Hostinger.
// Two subsets per family, as Google served them: latin, and latin-ext (where
// ₹ is), which the browser fetches only for a page that uses a character in
// its range. next/font/local gives every face of a call the same
// unicode-range, so latin-ext is a call of its own, with its own variable;
// globals.css lists it first in each font-family. IBM Plex Mono has 600 for
// the amounts in bold rows, which the browser would otherwise fake.
// tests/ladwani-fonts.test.js checks what these files draw.
const fraunces = localFont({
  src: [
    { path: './fonts/fraunces-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/fraunces-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/fraunces-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-display',
  // A serif stand-in while the face loads, as next/font/google chose; next/font/local defaults to Arial.
  adjustFontFallback: 'Times New Roman',
})
const frauncesExt = localFont({
  src: [
    { path: './fonts/fraunces-latin-ext-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/fraunces-latin-ext-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/fraunces-latin-ext-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-display-ext',
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' }],
})
const workSans = localFont({
  src: [
    { path: './fonts/work-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/work-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/work-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-body',
})
const workSansExt = localFont({
  src: [
    { path: './fonts/work-sans-latin-ext-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/work-sans-latin-ext-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/work-sans-latin-ext-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-body-ext',
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' }],
})
const plexMono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono',
})
const plexMonoExt = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-latin-ext-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-ext-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-ext-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono-ext',
  preload: false,
  adjustFontFallback: false,
  declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' }],
})
const fontVariables = [fraunces, frauncesExt, workSans, workSansExt, plexMono, plexMonoExt].map((f) => f.variable).join(' ')

export const metadata = {
  title: 'Mi Samaj',
  description: 'Community + Family + Trust',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
