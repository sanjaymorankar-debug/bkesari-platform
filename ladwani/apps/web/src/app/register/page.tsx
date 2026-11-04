'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ListSkeleton } from '../../components/ui'

/** The old address: joining moved to /sign-up (kept so old links and bookmarks work). */
export default function RegisterRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace(`/sign-up${window.location.search}`)
  }, [router])
  return (
    <main id="main" className="k-main k-main--narrow">
      <ListSkeleton rows={1} />
    </main>
  )
}
