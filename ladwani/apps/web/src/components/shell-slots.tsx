'use client'

import { useState } from 'react'

/**
 * The two slots the bkesari app shell (the hub's /shared/menu.js) fills in the
 * browser: the header bar and the footer.
 *
 * React must not write into them after the first render. It writes a
 * dangerouslySetInnerHTML again whenever the object is not the same object as
 * last time, and this static export applies the whole tree again, from the root
 * layout down, at every in-app move, each time with new objects. That emptied
 * the shell's bar and put the English footer back until a reload. Here each
 * object keeps its identity for the life of the page, so React leaves the
 * contents to the shell.
 */
const EMPTY = { __html: '' }

export function ShellHeader({ meUrl }: { meUrl: string }) {
  return <div data-bkesari-menu="" data-me-url={meUrl} suppressHydrationWarning dangerouslySetInnerHTML={EMPTY} />
}

export function ShellFooter({ html }: { html: string }) {
  const [inner] = useState(() => ({ __html: html }))
  return <div data-kesari-footer="" suppressHydrationWarning dangerouslySetInnerHTML={inner} />
}
