'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { api } from '../../../lib/api-client'
import { errorText } from '../../../lib/errors'
import { useT } from '../../../lib/i18n'
import { MARITAL_STATUSES, genderLabel, maritalLabel, personName } from '../../../lib/labels'
import { RequireAuth, TopBar, Shell, Avatar, StatusPill, EmptyState, ErrorState, RowSkeleton, PageHeader } from '../../../components/ui'
import { KIcon } from '../../../components/kicon'

interface MemberResult {
  id: string
  firstName: string
  lastName: string | null
  status: string
  currentCity?: string
  education?: string
  occupation?: string
}

interface LookupOption {
  id: string
  label: string
}

const PAGE_SIZE = 20
const GENDERS = ['FEMALE', 'MALE', 'OTHER'] as const

const NO_FILTERS = {
  q: '',
  city: '',
  state: '',
  gender: '',
  maritalStatus: '',
  educationLevelId: '',
  occupationId: '',
  minAge: '',
  maxAge: '',
  matrimonyAvailable: false,
}
type Filters = typeof NO_FILTERS

/** How many of the "more filters" are set, for the disclosure's label. */
function moreCount(f: Filters): number {
  return [f.state, f.gender, f.maritalStatus, f.educationLevelId, f.occupationId, f.minAge, f.maxAge].filter(Boolean).length + (f.matrimonyAvailable ? 1 : 0)
}

export default function MemberSearchPage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <MemberSearch />
      </Shell>
    </RequireAuth>
  )
}

/** The community directory: a name or a city first, more filters behind one disclosure. */
function MemberSearch() {
  const t = useT()
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [page, setPage] = useState(1)
  const [results, setResults] = useState<MemberResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lookups, setLookups] = useState<{ education: LookupOption[]; occupations: LookupOption[] }>({ education: [], occupations: [] })
  const resultsHeading = useRef<HTMLHeadingElement>(null)
  const extra = moreCount(filters)
  const hasAny = Boolean(filters.q.trim() || filters.city.trim()) || extra > 0

  useEffect(() => {
    Promise.all([api.get<LookupOption[]>('/config/education-levels').catch(() => []), api.get<LookupOption[]>('/config/occupations').catch(() => [])]).then(([education, occupations]) =>
      setLookups({ education, occupations }),
    )
  }, [])

  const set = (key: keyof Filters) => (e: { target: { value: string } }) => setFilters({ ...filters, [key]: e.target.value })

  async function search(targetPage = 1, f: Filters = filters) {
    setError(null)
    setPage(targetPage)
    setSearching(true)
    try {
      const params = new URLSearchParams()
      for (const key of ['q', 'city', 'state', 'gender', 'maritalStatus', 'educationLevelId', 'occupationId', 'minAge', 'maxAge'] as const) {
        const value = f[key].trim()
        if (value) params.set(key, value)
      }
      if (f.matrimonyAvailable) params.set('matrimonyAvailable', 'true')
      params.set('page', String(targetPage))
      params.set('pageSize', String(PAGE_SIZE))
      setResults(await api.get<MemberResult[]>(`/members/search?${params.toString()}`))
      if (targetPage !== 1) resultsHeading.current?.focus()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setSearching(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!hasAny) {
      setResults(null)
      return
    }
    search(1)
  }

  function clear() {
    setFilters(NO_FILTERS)
    setResults(null)
    setError(null)
  }

  return (
    <>
      <PageHeader title={t('search.title')} lead={t('search.lead')} />

      <form onSubmit={submit} className="k-card lw-search" role="search" aria-label={t('search.title')} noValidate>
        <div className="lw-search__main">
          <div className="k-field">
            <label className="k-label" htmlFor="lw-search-q">
              {t('search.name')}
            </label>
            <div className="k-search">
              <input id="lw-search-q" className="k-input" type="search" name="q" autoComplete="off" value={filters.q} onChange={set('q')} />
            </div>
          </div>
          <div className="k-field">
            <label className="k-label" htmlFor="lw-search-city">
              {t('field.city')}
            </label>
            <input id="lw-search-city" className="k-input" autoComplete="address-level2" value={filters.city} onChange={set('city')} />
          </div>
          <button className="k-btn lw-search__submit" type="submit" aria-busy={searching || undefined} disabled={searching}>
            <KIcon name="search" />
            {t('search.submit')}
          </button>
        </div>

        <details className="lw-search__more" open={extra > 0 || undefined}>
          <summary>
            {t('search.moreFilters')}
            {extra > 0 && <span className="k-chip k-chip--accent k-chip--plain">{t('search.filtersOn', { count: extra })}</span>}
          </summary>
          <div className="lw-search__grid">
            <div className="k-field">
              <label className="k-label" htmlFor="lw-search-state">
                {t('field.state')}
              </label>
              <input id="lw-search-state" className="k-input" autoComplete="address-level1" value={filters.state} onChange={set('state')} />
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="lw-search-gender">
                {t('field.gender')}
              </label>
              <select id="lw-search-gender" className="k-select" value={filters.gender} onChange={set('gender')}>
                <option value="">{t('search.any')}</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {genderLabel(t, g)}
                  </option>
                ))}
              </select>
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="lw-search-marital">
                {t('profile.maritalStatus')}
              </label>
              <select id="lw-search-marital" className="k-select" value={filters.maritalStatus} onChange={set('maritalStatus')}>
                <option value="">{t('search.any')}</option>
                {MARITAL_STATUSES.filter((s) => s !== 'NOT_STATED').map((s) => (
                  <option key={s} value={s}>
                    {maritalLabel(t, s)}
                  </option>
                ))}
              </select>
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="lw-search-education">
                {t('field.education')}
              </label>
              <select id="lw-search-education" className="k-select" value={filters.educationLevelId} onChange={set('educationLevelId')}>
                <option value="">{t('search.any')}</option>
                {lookups.education.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="k-field">
              <label className="k-label" htmlFor="lw-search-occupation">
                {t('field.occupation')}
              </label>
              <select id="lw-search-occupation" className="k-select" value={filters.occupationId} onChange={set('occupationId')}>
                <option value="">{t('search.any')}</option>
                {lookups.occupations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="lw-fieldset k-field lw-search__ages">
              <legend className="k-label">{t('search.age')}</legend>
              <div className="lw-two lw-two--tight">
                <div className="k-field">
                  <label className="k-hint" htmlFor="lw-search-min-age">
                    {t('search.ageFrom')}
                  </label>
                  <input id="lw-search-min-age" className="k-input" type="number" inputMode="numeric" min={0} max={120} value={filters.minAge} onChange={set('minAge')} />
                </div>
                <div className="k-field">
                  <label className="k-hint" htmlFor="lw-search-max-age">
                    {t('search.ageTo')}
                  </label>
                  <input id="lw-search-max-age" className="k-input" type="number" inputMode="numeric" min={0} max={120} value={filters.maxAge} onChange={set('maxAge')} />
                </div>
              </div>
            </fieldset>
            <label className="k-check lw-search__check">
              <input type="checkbox" checked={filters.matrimonyAvailable} onChange={(e) => setFilters({ ...filters, matrimonyAvailable: e.target.checked })} />
              <span>{t('search.matrimony')}</span>
            </label>
          </div>
        </details>
        {hasAny && (
          <button type="button" className="k-btn k-btn--ghost k-btn--sm lw-search__clear" onClick={clear}>
            {t('search.clear')}
          </button>
        )}
      </form>

      <section className="lw-results" aria-labelledby="lw-results-title" aria-busy={searching || undefined}>
        <h2 id="lw-results-title" ref={resultsHeading} tabIndex={-1} className={results ? 'lw-h3' : 'k-sr-only'}>
          {t('search.results')}
          {results && results.length > 0 && page > 1 && <span className="k-muted"> · {t('search.page', { page })}</span>}
        </h2>
        {error && <ErrorState message={error} onRetry={() => search(page)} />}
        {!error && searching && <RowSkeleton rows={4} />}
        {!error && !searching && results === null && <EmptyState icon="search" title={t('search.startTitle')} text={t('search.startText')} />}
        {!error && !searching && results?.length === 0 && (
          <EmptyState
            icon="users"
            title={t('search.noneTitle')}
            text={t('search.noneText')}
            action={
              extra > 0 ? (
                <button
                  type="button"
                  className="k-btn k-btn--secondary"
                  onClick={() => {
                    const fewer = { ...NO_FILTERS, q: filters.q, city: filters.city }
                    setFilters(fewer)
                    if (fewer.q.trim() || fewer.city.trim()) search(1, fewer)
                    else setResults(null)
                  }}
                >
                  {t('search.clearMore')}
                </button>
              ) : undefined
            }
          />
        )}
        {!error && !searching && results && results.length > 0 && (
          <ul className="k-statuslist">
            {results.map((m) => {
              const name = personName(m)
              const deceased = m.status === 'DECEASED'
              const meta = [m.currentCity, m.education, m.occupation].filter(Boolean).join(' · ')
              return (
                <li key={m.id} className="k-statusrow lw-result">
                  <Avatar name={name} deceased={deceased} />
                  <div>
                    <h3>
                      <Link href={`/members/${m.id}`} className="lw-result__link">
                        <span className={deceased ? 'lw-expired' : undefined}>{name}</span>
                        {deceased && <span className="k-sr-only"> ({t('tree.deceased')})</span>}
                      </Link>
                    </h3>
                    {meta && <p>{meta}</p>}
                    {/* Most members are active: only another status is worth a chip. */}
                    {m.status !== 'ACTIVE' && (
                      <p className="k-statusrow__meta">
                        <StatusPill status={m.status} />
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {!error && results && (results.length === PAGE_SIZE || page > 1) && (
          <nav className="k-pager" aria-label={t('search.pages')}>
            <button type="button" disabled={page === 1 || searching} onClick={() => search(page - 1)}>
              <KIcon name="arrow-left" small />
              <span>{t('search.prev')}</span>
            </button>
            <span aria-current="page">{t('search.page', { page })}</span>
            <button type="button" disabled={results.length < PAGE_SIZE || searching} onClick={() => search(page + 1)}>
              <span>{t('search.next')}</span>
              <KIcon name="arrow-right" small />
            </button>
          </nav>
        )}
      </section>
    </>
  )
}
