'use client'

import { useEffect, useState } from 'react'
import { api } from '../../../lib/api-client'
import { errorMessage } from '../../../lib/auth-context'
import { RequireAuth, TopBar, Shell, ErrorBanner } from '../../../components/ui'

interface CountRow {
  count: number
  [key: string]: unknown
}

interface Demographics {
  totalFamilies: number
  totalMembers: number
  byGender: CountRow[]
  byMaritalStatus: CountRow[]
  byStatus: CountRow[]
  byAgeBucket: { bucket: string; count: number }[]
  byArea: { area: string; count: number }[]
}

interface Matrimony {
  totalProfiles: number
  visibleProfiles: number
  totalInterests: number
  byInterestStatus: { status: string; count: number }[]
}

interface Services {
  assetsByCategory: { category: string; count: number }[]
  assetsByStatus: { status: string; count: number }[]
  bookingsByStatus: { status: string; count: number }[]
  topAssetsByRevenue: { asset: string; revenue: number }[]
}

interface Financial {
  ledgerByEntryType: { entryType: string; count: number; netAmount: number }[]
  feeCollection: { billed: number; paid: number; outstanding: number }
  donations: { totalPaidCount: number; totalAmount: number }
}

function Bar({ rows, labelKey, countKey }: { rows: Record<string, unknown>[]; labelKey: string; countKey: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[countKey])))
  return (
    <div className="stack">
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span style={{ width: 140, fontSize: 13 }}>{String(r[labelKey]).replace(/_/g, ' ')}</span>
          <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 4, height: 10 }}>
            <div style={{ width: `${(Number(r[countKey]) / max) * 100}%`, background: 'var(--accent)', height: 10, borderRadius: 4 }} />
          </div>
          <span className="mono" style={{ width: 40, textAlign: 'right', fontSize: 13 }}>{String(r[countKey])}</span>
        </div>
      ))}
    </div>
  )
}

function ExportLink({ report }: { report: string }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  async function download() {
    setDownloading(true)
    setDownloadError(null)
    try {
      const blob = await api.getBlob(`/reports/${report}/export.csv`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${report}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setDownloadError(errorMessage(err))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
      {downloadError && <span className="muted" style={{ color: 'var(--danger)', fontSize: 13 }}>{downloadError}</span>}
      <button className="btn btn-outline" onClick={download} disabled={downloading}>
        {downloading ? 'Preparing…' : 'Export CSV'}
      </button>
    </div>
  )
}

export default function AdminReportsPage() {
  const [demographics, setDemographics] = useState<Demographics | null>(null)
  const [matrimony, setMatrimony] = useState<Matrimony | null>(null)
  const [services, setServices] = useState<Services | null>(null)
  const [financial, setFinancial] = useState<Financial | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get<Demographics>('/reports/demographics').then(setDemographics).catch((err) => setError(errorMessage(err)))
    api.get<Matrimony>('/reports/matrimony').then(setMatrimony).catch((err) => setError(errorMessage(err)))
    api.get<Services>('/reports/services').then(setServices).catch((err) => setError(errorMessage(err)))
    api.get<Financial>('/reports/financial').then(setFinancial).catch((err) => setError(errorMessage(err)))
  }, [])

  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <h1>Reports</h1>
        <ErrorBanner message={error} />

        <div className="stack">
          {demographics && (
            <div className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>Demographics</h3>
                <ExportLink report="demographics" />
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {demographics.totalFamilies.toLocaleString('en-IN')} families · {demographics.totalMembers.toLocaleString('en-IN')} members
              </p>
              <h4 style={{ margin: '8px 0 0' }}>By gender</h4>
              <Bar rows={demographics.byGender} labelKey="gender" countKey="count" />
              <h4 style={{ margin: '8px 0 0' }}>By age</h4>
              <Bar rows={demographics.byAgeBucket} labelKey="bucket" countKey="count" />
              <h4 style={{ margin: '8px 0 0' }}>By area</h4>
              <Bar rows={demographics.byArea} labelKey="area" countKey="count" />
            </div>
          )}

          {matrimony && (
            <div className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>Matrimony</h3>
                <ExportLink report="matrimony" />
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {matrimony.totalProfiles.toLocaleString('en-IN')} profiles ({matrimony.visibleProfiles.toLocaleString('en-IN')} visible) ·{' '}
                {matrimony.totalInterests.toLocaleString('en-IN')} interests sent
              </p>
              <Bar rows={matrimony.byInterestStatus} labelKey="status" countKey="count" />
            </div>
          )}

          {services && (
            <div className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>Services & bookings</h3>
                <ExportLink report="services" />
              </div>
              <h4 style={{ margin: 0 }}>Assets by category</h4>
              <Bar rows={services.assetsByCategory} labelKey="category" countKey="count" />
              <h4 style={{ margin: '8px 0 0' }}>Bookings by status</h4>
              <Bar rows={services.bookingsByStatus} labelKey="status" countKey="count" />
              {services.topAssetsByRevenue.length > 0 && (
                <>
                  <h4 style={{ margin: '8px 0 0' }}>Top assets by revenue</h4>
                  {services.topAssetsByRevenue.map((r, i) => (
                    <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                      <span>{r.asset}</span>
                      <span className="mono">₹{r.revenue.toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {financial && (
            <div className="card stack">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>Financial</h3>
                <ExportLink report="financial" />
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Fees billed</span>
                <span className="mono">₹{financial.feeCollection.billed.toLocaleString('en-IN')}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Fees collected</span>
                <span className="mono">₹{financial.feeCollection.paid.toLocaleString('en-IN')}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', fontWeight: 600 }}>
                <span>Outstanding</span>
                <span className="mono">₹{financial.feeCollection.outstanding.toLocaleString('en-IN')}</span>
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted">Donations received</span>
                <span className="mono">₹{financial.donations.totalAmount.toLocaleString('en-IN')} ({financial.donations.totalPaidCount})</span>
              </div>
              <h4 style={{ margin: '8px 0 0' }}>Ledger by entry type</h4>
              {financial.ledgerByEntryType.map((r, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{r.entryType} <span className="muted">({r.count})</span></span>
                  <span className="mono">₹{r.netAmount.toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Shell>
    </RequireAuth>
  )
}
