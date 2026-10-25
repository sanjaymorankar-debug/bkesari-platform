'use client'

import Link from 'next/link'
import { RequireAuth, TopBar, Shell } from '../../../components/ui'

export default function FamilySetupPage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Are you joining an existing family, or registering a new one?</h1>
        <div className="row" style={{ marginTop: 24, alignItems: 'stretch' }}>
          <Link href="/family/join" className="card stack" style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
            <h3>Join an existing family</h3>
            <p className="muted">Search for your family by name or registration number and request to join.</p>
            <span className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>
              Search families
            </span>
          </Link>
          <Link href="/family/new" className="card stack" style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}>
            <h3>Register a new family</h3>
            <p className="muted">Your family isn&apos;t on the platform yet. Register it and become its Karta.</p>
            <span className="btn btn-accent" style={{ alignSelf: 'flex-start' }}>
              Register family
            </span>
          </Link>
        </div>
      </Shell>
    </RequireAuth>
  )
}
