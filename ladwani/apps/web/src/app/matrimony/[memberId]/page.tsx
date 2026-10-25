import { ClientOnly } from '@/components/client-only'
import { PLACEHOLDER } from '@/lib/route-placeholder'
import View from './view'

/** The static export builds this page once; see src/lib/route-params.ts. */
export function generateStaticParams() {
  return [{ memberId: PLACEHOLDER }]
}

export default function Page() {
  return (
    <ClientOnly>
      <View />
    </ClientOnly>
  )
}
