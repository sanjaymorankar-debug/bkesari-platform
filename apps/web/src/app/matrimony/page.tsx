'use client'

import Link from 'next/link'
import { RequireAuth, TopBar, Shell } from '../../components/ui'

export default function MatrimonyHubPage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Matrimony</h1>
        <p className="muted">Your matrimonial profile is opt-in and separate from your family profile.</p>
        <div className="stack" style={{ marginTop: 24 }}>
          <Link href="/matrimony/profile" className="card row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
            <div>
              <h3 style={{ marginBottom: 4 }}>My matrimonial profile</h3>
              <p className="muted" style={{ margin: 0 }}>Create or edit your profile and visibility settings.</p>
            </div>
            <span className="btn btn-outline">Manage</span>
          </Link>
          <Link href="/matrimony/search" className="card row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
            <div>
              <h3 style={{ marginBottom: 4 }}>Search profiles</h3>
              <p className="muted" style={{ margin: 0 }}>Browse profiles that have opted in to being discoverable.</p>
            </div>
            <span className="btn btn-outline">Search</span>
          </Link>
          <Link href="/matrimony/interests" className="card row" style={{ justifyContent: 'space-between', textDecoration: 'none', color: 'inherit' }}>
            <div>
              <h3 style={{ marginBottom: 4 }}>Interests</h3>
              <p className="muted" style={{ margin: 0 }}>Manage interests you&apos;ve sent and received.</p>
            </div>
            <span className="btn btn-outline">View</span>
          </Link>
        </div>
      </Shell>
    </RequireAuth>
  )
}
