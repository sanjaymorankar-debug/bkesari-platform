'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { api, ApiError } from '../../lib/api-client'
import { errorText } from '../../lib/errors'
import { useT, type MessageKey, type Translate } from '../../lib/i18n'
import { formatDate, formatDateTime, toast } from '../../lib/kesari'
import { genderLabel, humanize, idProofLabel, maritalLabel, personName, relationLabel } from '../../lib/labels'
import { RequireAuth, TopBar, Shell, EmptyState, ErrorState, RowSkeleton, Modal, PageHeader } from '../../components/ui'
import { KIcon, PIcon, type KIconName } from '../../components/kicon'

/** A row of GET /approvals, as the API sends it. */
interface ApprovalRow {
  id: string
  actionCode: string
  entityType: string | null
  entityId: string | null
  newValue: unknown
  status: string
  submittedBy: string
  submittedAt: string
}

/** What GET /members/:id shows an operator (the privacy rules may hold some of it back). */
interface MemberInfo {
  id: string
  firstName: string
  lastName: string | null
  gender?: string
  status?: string
  maritalStatus?: string
  dateOfBirth?: string | null
  currentCity?: string | null
  currentState?: string | null
  nativeVillage?: string | null
}

/** What GET /families/:id shows. */
interface FamilyInfo {
  id: string
  name: string
  registrationNumber: string
  nativeVillage?: string | null
  nativeDistrict?: string | null
  nativeState?: string | null
  gotra?: string | null
  kuladevata?: string | null
  members: { id: string; firstName: string; lastName: string | null; isKarta: boolean }[]
}

/** The member and family records the requests name, as far as they have loaded. */
interface Lookups {
  member(id: unknown): MemberInfo | undefined
  family(id: unknown): FamilyInfo | undefined
}

/** A record's key: "m:<member id>" or "f:<family id>". Its value: the record, null when it failed, absent while loading. */
type Records = Record<string, MemberInfo | FamilyInfo | null>

type Decision = 'APPROVED' | 'REJECTED'

/** Every action code the approval rules know (approval_rules), in words and with an icon. */
const KINDS: Record<string, { title: MessageKey; icon: KIconName }> = {
  'member.id_proof.verify': { title: 'approvals.idProof', icon: 'shield' },
  'family.create': { title: 'approvals.familyCreate', icon: 'ladwani' },
  'family.member.add': { title: 'approvals.memberAdd', icon: 'users' },
  'member.marital_status.change': { title: 'approvals.marital', icon: 'heart' },
  'member.mark_deceased': { title: 'approvals.deceased', icon: 'user' },
  'member.relationship.change': { title: 'approvals.relationship', icon: 'users' },
  'family.karta.transfer': { title: 'approvals.kartaTransfer', icon: 'users' },
  'family.merge': { title: 'approvals.familyMerge', icon: 'ladwani' },
  'asset.register': { title: 'approvals.assetRegister', icon: 'map-pin' },
  'asset.suspend': { title: 'approvals.assetSuspend', icon: 'stop' },
  'offline_payment.verify': { title: 'approvals.payment', icon: 'check' },
  'data.deletion_request': { title: 'approvals.dataDeletion', icon: 'lock' },
}

const MEMBER_REFS = ['relatedToMemberId', 'memberId', 'spouseMemberId'] as const

/** newValue as an object, whatever the API stored. */
function valueOf(row: ApprovalRow): Record<string, unknown> {
  return row.newValue && typeof row.newValue === 'object' && !Array.isArray(row.newValue) ? (row.newValue as Record<string, unknown>) : {}
}
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

function titleOf(t: Translate, code: string): string {
  const kind = KINDS[code]
  return kind ? t(kind.title) : t('approvals.other', { code: humanize(code) })
}

interface Fact {
  label: string
  value: ReactNode
}
interface Described {
  title: string
  icon: KIconName
  /** Who is asking, in words. */
  who: string
  facts: Fact[]
  links: { href: string; label: string }[]
  note?: string
  warning?: string
}

/** Any value from newValue, readable: dates as "3 Nov 2026", codes in words, nested objects one level deep. */
function plain(t: Translate, value: unknown): string {
  if (value == null || value === '') return ''
  if (typeof value === 'boolean') return value ? t('approvals.yes') : t('approvals.no')
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) return formatDate(value)
    return /^[A-Z][A-Z0-9_]+$/.test(value) ? humanize(value) : value
  }
  if (Array.isArray(value)) return value.map((v) => plain(t, v)).filter(Boolean).join(', ')
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => {
      const text = plain(t, v)
      return text ? `${humanize(k)}: ${text}` : ''
    })
    .filter(Boolean)
    .join(' · ')
}

/**
 * One request in words: what it is for, who is asking and the details an
 * operator checks. Names come from the member and family records; where the
 * record does not say who sent it, the sentence says who could have.
 */
function describe(row: ApprovalRow, look: Lookups, t: Translate): Described {
  const v = valueOf(row)
  const { member, family } = look
  const nameOf = (m: { firstName?: string | null; lastName?: string | null } | undefined) => personName(m) || t('approvals.someone')
  const kartaOf = (f: FamilyInfo | undefined) => f?.members.find((x) => x.isKarta)
  const place = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(', ')
  const add = (facts: Fact[], label: string, value: ReactNode) => {
    if (value !== '' && value != null) facts.push({ label, value })
  }
  const base = { title: titleOf(t, row.actionCode), icon: KINDS[row.actionCode]?.icon ?? 'info', facts: [] as Fact[], links: [] as Described['links'] }
  const subject = row.entityType === 'Member' ? member(row.entityId) : undefined
  const profileLink = (id: string | null | undefined, label: MessageKey = 'approvals.openProfile') => (id ? [{ href: `/members/${id}`, label: t(label) }] : [])

  switch (row.actionCode) {
    case 'member.id_proof.verify': {
      const d: Described = { ...base, who: t('approvals.whoNewMember', { name: nameOf(subject) }), links: profileLink(row.entityId), note: t('approvals.documentNote') }
      add(d.facts, t('approvals.document'), idProofLabel(t, str(v.kind)))
      add(d.facts, t('approvals.member'), personName(subject))
      add(d.facts, t('field.dateOfBirth'), subject?.dateOfBirth ? formatDate(subject.dateOfBirth) : '')
      add(d.facts, t('profile.lives'), place(subject?.currentCity, subject?.currentState))
      add(d.facts, t('profile.nativePlace'), subject?.nativeVillage ?? '')
      return d
    }
    case 'family.create': {
      const f = family(row.entityId)
      const karta = kartaOf(f)
      const duplicates = Array.isArray(v.duplicates) ? (v.duplicates as { id?: string }[]) : []
      const d: Described = {
        ...base,
        who: karta ? t('approvals.whoFutureKarta', { name: nameOf(karta) }) : t('approvals.whoUnknown'),
        links: row.entityId ? [{ href: `/family/${row.entityId}`, label: t('approvals.openFamily') }] : [],
        warning: duplicates.length ? t('approvals.duplicates', { count: duplicates.length }) : undefined,
      }
      add(d.facts, t('approvals.family'), f?.name ?? '')
      add(d.facts, t('family.regNo'), f ? <span className="lw-mono">{f.registrationNumber}</span> : '')
      add(d.facts, t('profile.nativePlace'), place(f?.nativeVillage, f?.nativeDistrict, f?.nativeState))
      add(d.facts, t('family.gotra'), f?.gotra ?? '')
      add(d.facts, t('family.kuladevata'), f?.kuladevata ?? '')
      duplicates.forEach((dup, i) => dup.id && d.links.push({ href: `/family/${dup.id}`, label: t('approvals.openDuplicate', { n: i + 1 }) }))
      return d
    }
    case 'family.member.add': {
      const f = family(v.familyId)
      const related = member(v.relatedToMemberId)
      const relation = str(v.relationshipTypeCode)
      const relationText = relation ? (related ? t('tree.relationOf', { relation: relationLabel(t, relation), name: nameOf(related) }) : relationLabel(t, relation)) : ''
      const links = str(v.familyId) ? [{ href: `/family/${v.familyId}/tree`, label: t('approvals.openTree') }] : []
      if (v.mode === 'EXISTING') {
        const joining = member(v.memberId)
        const d: Described = { ...base, who: t('approvals.whoMember', { name: nameOf(joining) }), links: [...profileLink(str(v.memberId)), ...links] }
        add(d.facts, t('approvals.member'), personName(joining))
        add(d.facts, t('approvals.joins'), f?.name ?? '')
        add(d.facts, t('tree.relation'), relationText)
        return d
      }
      const data = (v.memberData && typeof v.memberData === 'object' ? v.memberData : {}) as Record<string, unknown>
      const karta = kartaOf(f)
      const d: Described = {
        ...base,
        who: karta && f ? t('approvals.whoKarta', { name: nameOf(karta), family: f.name }) : t('approvals.whoKartaUnknown'),
        links,
      }
      add(d.facts, t('approvals.newMember'), personName(data as { firstName?: string; lastName?: string }))
      add(d.facts, t('tree.relation'), relationText)
      add(d.facts, t('field.dateOfBirth'), str(data.dateOfBirth) ? formatDate(data.dateOfBirth as string) : '')
      add(d.facts, t('field.gender'), str(data.gender) && data.gender !== 'NOT_STATED' ? genderLabel(t, data.gender as string) : '')
      add(d.facts, t('profile.lives'), place(str(data.currentCity), str(data.currentState)))
      add(d.facts, t('approvals.family'), f?.name ?? '')
      return d
    }
    case 'member.marital_status.change': {
      const spouse =
        str(v.externalSpouseName) ??
        (str(v.spouseMemberId) ? personName(member(v.spouseMemberId)) || t('approvals.someone') : '') ??
        ''
      const spouseText = spouse
        ? `${spouse} (${v.spouseMode === 'NON_COMMUNITY' ? t('profile.spouseNotHere') : t('profile.spouseHere')})`
        : v.newSpouseData && typeof v.newSpouseData === 'object'
          ? `${personName(v.newSpouseData as { firstName?: string; lastName?: string })} (${t('approvals.newMember')})`
          : ''
      const d: Described = { ...base, who: t('approvals.whoMemberOrKarta', { name: nameOf(subject) }), links: profileLink(row.entityId) }
      add(d.facts, t('approvals.member'), personName(subject))
      add(d.facts, t('approvals.maritalNow'), subject?.maritalStatus ? maritalLabel(t, subject.maritalStatus) : '')
      add(d.facts, t('approvals.maritalNew'), maritalLabel(t, str(v.status)))
      add(d.facts, t('profile.spouse'), spouseText)
      add(d.facts, t('approvals.since'), str(v.effectiveDate) ? formatDate(v.effectiveDate as string) : '')
      return d
    }
    case 'member.mark_deceased': {
      const d: Described = { ...base, who: t('approvals.whoKartaOrAdmin', { name: nameOf(subject) }), links: profileLink(row.entityId), note: t('approvals.deceasedNote') }
      add(d.facts, t('approvals.member'), personName(subject))
      add(d.facts, t('profile.deathDate'), str(v.deceasedAt) ? formatDate(v.deceasedAt as string) : '')
      add(d.facts, t('profile.deathPlace'), str(v.deceasedPlace) ?? '')
      return d
    }
    case 'asset.register':
    case 'asset.suspend': {
      const d: Described = { ...base, who: t(row.actionCode === 'asset.register' ? 'approvals.whoOwner' : 'approvals.whoAdmin'), links: row.entityId ? [{ href: `/assets/${row.entityId}`, label: t('approvals.openListing') }] : [] }
      add(d.facts, t('approvals.reason'), str(v.reason) ?? '')
      return d
    }
    default: {
      // Anything else: each stored value, in words (never raw JSON).
      const d: Described = { ...base, who: subject ? t('approvals.whoAbout', { name: nameOf(subject) }) : t('approvals.whoUnknown'), links: row.entityType === 'Member' ? profileLink(row.entityId) : [] }
      for (const [key, value] of Object.entries(v)) {
        if (/Id$/.test(key)) continue
        add(d.facts, humanize(key), plain(t, value))
      }
      if (!d.facts.length && row.entityId) add(d.facts, t('approvals.reference'), <span className="lw-mono">{row.entityId}</span>)
      return d
    }
  }
}

/** How long a request has waited: new, hours, then days (amber past two, the time members are told it takes). */
function waited(t: Translate, iso: string): { text: string; tone: string } {
  const hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hours < 1) return { text: t('approvals.new'), tone: 'accent' }
  if (hours < 24) return { text: Math.floor(hours) === 1 ? t('approvals.waitingHour') : t('approvals.waitingHours', { count: Math.floor(hours) }), tone: 'plain' }
  const days = Math.floor(hours / 24)
  return { text: days === 1 ? t('approvals.waitingDay') : t('approvals.waitingDays', { count: days }), tone: days >= 2 ? 'warning' : 'plain' }
}

/** The records a request names: its member or family, and the people and family in what it asks. */
function keysFor(row: ApprovalRow): string[] {
  const v = valueOf(row)
  const keys = new Set<string>()
  if (row.entityType === 'Member' && row.entityId) keys.add(`m:${row.entityId}`)
  if (row.entityType === 'Family' && row.entityId) keys.add(`f:${row.entityId}`)
  for (const key of MEMBER_REFS) if (str(v[key])) keys.add(`m:${v[key]}`)
  if (str(v.familyId)) keys.add(`f:${v.familyId}`)
  return Array.from(keys)
}

/** How long to wait before asking again for a record the API refused as too many requests (it allows 20 a minute). */
const RETRY_AFTER_MS = 20_000

/**
 * The records the cards on screen need, fetched two at a time and each only
 * once, so a long queue never trips the API's rate limit; one refused as too
 * many requests is asked for once more a little later.
 */
function useRecords(): { records: Records; need: (keys: string[]) => void; look: Lookups } {
  const [records, setRecords] = useState<Records>({})
  const requested = useRef(new Set<string>())
  const retried = useRef(new Set<string>())
  const queue = useRef<string[]>([])
  const active = useRef(0)

  const pump = useCallback(() => {
    while (active.current < 2 && queue.current.length) {
      const key = queue.current.shift()!
      const id = encodeURIComponent(key.slice(2))
      active.current += 1
      api
        .get<MemberInfo | FamilyInfo>(key.startsWith('m:') ? `/members/${id}` : `/families/${id}`)
        .then(
          (record) => setRecords((r) => ({ ...r, [key]: record })),
          (err) => {
            if (err instanceof ApiError && err.status === 429 && !retried.current.has(key)) {
              retried.current.add(key)
              window.setTimeout(() => {
                queue.current.push(key)
                pump()
              }, RETRY_AFTER_MS)
            } else setRecords((r) => ({ ...r, [key]: null }))
          },
        )
        .finally(() => {
          active.current -= 1
          pump()
        })
    }
  }, [])

  const need = useCallback(
    (keys: string[]) => {
      for (const key of keys) {
        if (requested.current.has(key)) continue
        requested.current.add(key)
        queue.current.push(key)
      }
      pump()
    },
    [pump],
  )

  const look = useMemo<Lookups>(
    () => ({
      member: (id) => (typeof id === 'string' ? ((records[`m:${id}`] as MemberInfo | null) ?? undefined) : undefined),
      family: (id) => (typeof id === 'string' ? ((records[`f:${id}`] as FamilyInfo | null) ?? undefined) : undefined),
    }),
    [records],
  )
  return { records, need, look }
}

export default function ApprovalsPage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <ApprovalQueue />
      </Shell>
    </RequireAuth>
  )
}

/**
 * The operator queue (GET /approvals, POST /approvals/:id/decide): every
 * request in words, oldest first, with who is asking and what to check, and
 * a confirmation (with an optional note to the member) before it is decided.
 */
function ApprovalQueue() {
  const t = useT()
  const [rows, setRows] = useState<ApprovalRow[] | null>(null)
  // The raw failure: put in words when shown, so it follows the language.
  const [error, setError] = useState<{ err: unknown; forbidden: boolean } | null>(null)
  const { records, need, look } = useRecords()
  const [kind, setKind] = useState('')
  const [deciding, setDeciding] = useState<{ row: ApprovalRow; decision: Decision } | null>(null)
  const listHeading = useRef<HTMLHeadingElement>(null)
  /** Set once a request is decided: its card (and the button that opened the dialog) is gone, so focus goes to the list. */
  const focusList = useRef(false)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setError(null)
      setRows(null)
    }
    try {
      setRows(await api.get<ApprovalRow[]>('/approvals'))
    } catch (err) {
      if (!quiet) setError({ err, forbidden: err instanceof ApiError && err.status === 403 })
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const kinds = useMemo(() => {
    const counts = new Map<string, number>()
    rows?.forEach((r) => counts.set(r.actionCode, (counts.get(r.actionCode) ?? 0) + 1))
    return Array.from(counts.entries())
  }, [rows])
  const shown = rows?.filter((r) => !kind || r.actionCode === kind) ?? []
  const oldest = rows?.[0]

  function decided(row: ApprovalRow, decision: Decision) {
    setDeciding(null)
    toast(t(decision === 'APPROVED' ? 'approvals.approvedToast' : 'approvals.rejectedToast', { title: titleOf(t, row.actionCode) }), 'success')
    setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? null)
    if (kind && !rows?.some((r) => r.id !== row.id && r.actionCode === kind)) setKind('')
    focusList.current = true
    load(true)
  }

  /** The dialog has closed (Esc, Cancel, or a decision): after a decision, carry on from the list. */
  function dialogClosed() {
    setDeciding(null)
    if (!focusList.current) return
    focusList.current = false
    // After the page is no longer inert behind the modal, and after Kesari's own focus return.
    window.setTimeout(() => listHeading.current?.focus(), 0)
  }

  return (
    <>
      <PageHeader
        title={t('approvals.title')}
        lead={t('approvals.lead')}
        meta={
          rows && rows.length > 0 ? (
            <>
              <span className="k-chip k-chip--warning">{t('approvals.count', { count: rows.length })}</span>
              {oldest && <span className="k-small k-muted">{t('approvals.oldest', { date: formatDate(oldest.submittedAt) })}</span>}
            </>
          ) : undefined
        }
        actions={
          <Link href="/community/moderation" className="k-link-arrow">
            {t('approvals.moderation')}
            <KIcon name="arrow-right" />
          </Link>
        }
      />

      {error &&
        (error.forbidden ? (
          <EmptyState icon="lock" title={t('approvals.forbiddenTitle')} text={t('approvals.forbiddenText')} action={<Link href="/dashboard" className="k-btn k-btn--secondary">{t('pending.toHome')}</Link>} />
        ) : (
          <ErrorState message={t('approvals.loadError', { reason: errorText(error.err, t) })} onRetry={() => load()} />
        ))}
      {!rows && !error && <RowSkeleton rows={3} tall />}
      {rows?.length === 0 && (
        <EmptyState
          icon="check"
          title={t('approvals.emptyTitle')}
          text={t('approvals.emptyText')}
          action={
            <Link href="/community/moderation" className="k-btn k-btn--secondary">
              {t('approvals.moderation')}
            </Link>
          }
        />
      )}

      {rows && rows.length > 0 && (
        <section aria-labelledby="lw-queue-title">
          <div className="lw-queue-bar">
            <h2 id="lw-queue-title" ref={listHeading} tabIndex={-1} className="lw-h3">
              {t('approvals.listTitle')}
            </h2>
            {kinds.length > 1 && (
              <div className="k-field lw-queue-filter">
                <label className="k-label" htmlFor="lw-queue-kind">
                  {t('approvals.filter')}
                </label>
                <select id="lw-queue-kind" className="k-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">{t('approvals.filterAll', { count: rows.length })}</option>
                  {kinds.map(([code, count]) => (
                    <option key={code} value={code}>
                      {t('approvals.filterKind', { kind: titleOf(t, code), count })}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <ol className="lw-queue">
            {shown.map((row) => (
              <Request key={row.id} row={row} look={look} records={records} need={need} onDecide={(decision) => setDeciding({ row, decision })} />
            ))}
          </ol>
        </section>
      )}

      <DecideDialog deciding={deciding} look={look} onClose={dialogClosed} onDecided={decided} onGone={() => {
        setDeciding(null)
        toast(t('approvals.alreadyDone'))
        load(true)
      }} />
    </>
  )
}

function Request({ row, look, records, need, onDecide }: { row: ApprovalRow; look: Lookups; records: Records; need: (keys: string[]) => void; onDecide: (d: Decision) => void }) {
  const t = useT()
  const card = useRef<HTMLLIElement>(null)
  const keys = useMemo(() => keysFor(row), [row])
  const looking = keys.some((k) => !(k in records))
  const missing = keys.some((k) => records[k] === null)
  const d = describe(row, look, t)

  // Its records are asked for when the card comes near the screen.
  useEffect(() => {
    const el = card.current
    if (!el || !keys.length) return
    if (typeof IntersectionObserver === 'undefined') return need(keys)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          need(keys)
          observer.disconnect()
        }
      },
      { rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [keys, need])
  const age = waited(t, row.submittedAt)
  const ids = { title: `lw-req-${row.id}`, who: `lw-req-${row.id}-who` }
  return (
    <li ref={card} className="lw-request" aria-labelledby={ids.title} aria-busy={looking || undefined}>
      <div className="lw-request__head">
        <PIcon name={d.icon} size="sm" />
        <div className="lw-request__heading">
          <h3 id={ids.title}>{d.title}</h3>
          <p id={ids.who} className="lw-request__who">
            {looking ? <span className="k-skel k-skel--line lw-request__who-skel" aria-hidden="true" /> : d.who}
          </p>
        </div>
        <span className={`k-chip k-chip--${age.tone}`}>{age.text}</span>
      </div>

      {looking ? (
        <div aria-hidden="true">
          <span className="k-skel k-skel--line" />
          <span className="k-skel k-skel--line lw-rows-skel__short" />
        </div>
      ) : (
        d.facts.length > 0 && (
          <dl className="lw-facts lw-request__facts">
            {d.facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )
      )}
      {missing && (
        <p className="lw-request__note">
          <KIcon name="alert" small />
          <span>{t('approvals.detailsMissing')}</span>
        </p>
      )}
      {d.warning && (
        <div className="k-banner k-banner--warning">
          <KIcon name="alert" />
          <p>{d.warning}</p>
        </div>
      )}
      {d.note && (
        <p className="lw-request__note">
          <KIcon name="info" small />
          <span>{d.note}</span>
        </p>
      )}

      <div className="lw-request__foot">
        <div className="lw-request__meta">
          <p className="k-small k-muted">{t('approvals.sent', { date: formatDateTime(row.submittedAt) })}</p>
          {d.links.length > 0 && (
            <ul className="lw-request__links">
              {d.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="k-link-arrow">
                    {l.label}
                    <KIcon name="arrow-right" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="lw-request__actions">
          <button type="button" className="k-btn k-btn--secondary" aria-describedby={`${ids.title} ${ids.who}`} onClick={() => onDecide('REJECTED')}>
            <KIcon name="close" />
            {t('approvals.reject')}
          </button>
          <button type="button" className="k-btn k-btn--soft" aria-describedby={`${ids.title} ${ids.who}`} onClick={() => onDecide('APPROVED')}>
            <KIcon name="check" />
            {t('approvals.approve')}
          </button>
        </div>
      </div>
    </li>
  )
}

/** "Approve / Reject this request?": what it is, what happens next, and an optional note the member sees. */
function DecideDialog({
  deciding,
  look,
  onClose,
  onDecided,
  onGone,
}: {
  deciding: { row: ApprovalRow; decision: Decision } | null
  look: Lookups
  onClose: () => void
  onDecided: (row: ApprovalRow, decision: Decision) => void
  onGone: () => void
}) {
  const t = useT()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const approve = deciding?.decision === 'APPROVED'

  useEffect(() => {
    setNote('')
    setError(null)
    setBusy(false)
  }, [deciding])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!deciding) return
    setError(null)
    setBusy(true)
    try {
      await api.post(`/approvals/${deciding.row.id}/decide`, { decision: deciding.decision, note: note.trim() || undefined })
      onDecided(deciding.row, deciding.decision)
    } catch (err) {
      setBusy(false)
      // Someone else decided it first.
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onGone()
      else setError(errorText(err, t))
    }
  }

  const d = deciding ? describe(deciding.row, look, t) : null
  return (
    <Modal
      open={!!deciding}
      onClose={onClose}
      title={approve ? t('approvals.approveTitle') : t('approvals.rejectTitle')}
      onSubmit={submit}
      footer={
        <>
          <button type="button" className="k-btn k-btn--secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={approve ? 'k-btn' : 'k-btn k-btn--danger'} aria-busy={busy || undefined} disabled={busy}>
            {approve ? t('approvals.approve') : t('approvals.rejectConfirm')}
          </button>
        </>
      }
    >
      {d && (
        <div className="lw-decide__what">
          <strong>{d.title}</strong>
          <span className="k-muted">{d.who}</span>
        </div>
      )}
      <p>{approve ? t('approvals.approveText') : t('approvals.rejectText')}</p>
      {error && (
        <div className="k-banner k-banner--danger" role="alert">
          <p>{error}</p>
        </div>
      )}
      <div className="k-field">
        <label className="k-label" htmlFor="lw-decide-note">
          {t('approvals.note')} <span className="k-hint">({t('common.optional')})</span>
        </label>
        <span className="k-hint" id="lw-decide-note-hint">
          {approve ? t('approvals.noteHint') : t('approvals.noteRejectHint')}
        </span>
        <textarea id="lw-decide-note" className="k-textarea" rows={3} maxLength={500} aria-describedby="lw-decide-note-hint" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  )
}
