'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../lib/api-client'
import { errorMessage } from '../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner, StatusPill } from '../../components/ui'

interface MyFamily {
  familyId: string
  familyName: string
  registrationNumber: string
  status: string
  verificationStatus: string
  isKarta: boolean
}

export default function DashboardPage() {
  const [families, setFamilies] = useState<MyFamily[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<MyFamily[]>('/families/mine')
      .then(setFamilies)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Dashboard</h1>
        <ErrorBanner message={error} />

        {families === null && !error && <p className="muted">Loading…</p>}

        {families && families.length === 0 && (
          <div className="card stack">
            <h3>You&apos;re not linked to a family yet</h3>
            <p className="muted">Register a new family, or find and join one that&apos;s already on the platform.</p>
            <Link href="/family/setup" className="btn btn-accent" style={{ alignSelf: 'flex-start' }}>
              Set up your family
            </Link>
          </div>
        )}

        {families && families.length > 0 && (
          <div className="stack">
            {families.map((f) => (
              <Link key={f.familyId} href={`/family/${f.familyId}`} className="card row" style={{ textDecoration: 'none', color: 'inherit', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ marginBottom: 4 }}>{f.familyName}</h3>
                  <p className="muted mono" style={{ margin: 0, fontSize: 13 }}>
                    {f.registrationNumber} {f.isKarta && '· You are the Karta'}
                  </p>
                </div>
                <StatusPill status={f.status} />
              </Link>
            ))}
          </div>
        )}
      </Shell>
    </RequireAuth>
  )
}
