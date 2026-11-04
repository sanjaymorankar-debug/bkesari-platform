'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import Link from 'next/link'
import { useRouteParams } from '@/lib/route-params'
import { api } from '../../../../lib/api-client'
import { errorMessage } from '../../../../lib/auth-context'
import { hasMessage, useT, type Translate } from '../../../../lib/i18n'
import { formatDate, kesari } from '../../../../lib/kesari'
import { branchIds, buildFamilyTree, countMembers, fullName, isExpired, type TreeEdge, type TreeNode, type TreeUnit } from '../../../../lib/tree-layout'
import { EmptyState, ErrorState, ListSkeleton, RequireAuth, Shell, StatusPill, TopBar } from '../../../../components/ui'
import { Tabs, tabPanelProps } from '../../../../components/auth-ui'
import { Icon } from '../../../../components/icons'

interface TreeResponse {
  familyId: string
  familyName: string
  nodes: TreeNode[]
  edges: TreeEdge[]
}

type View = 'chart' | 'list'
const MIN_ZOOM = 0.4
const MAX_ZOOM = 2
/** Phones narrower than this open the list; the chart is one tap away. */
const LIST_BELOW_PX = 480

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))

export default function FamilyTreePage() {
  return (
    <RequireAuth>
      <TopBar />
      <Shell>
        <FamilyTree />
      </Shell>
    </RequireAuth>
  )
}

function FamilyTree() {
  const t = useT()
  const { id } = useRouteParams<{ id: string }>('/family/[id]/tree')
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('chart')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<TreeNode | null>(null)
  const tabsId = useId()

  const load = useCallback(() => {
    setError(null)
    setTree(null)
    api
      .get<TreeResponse>(`/families/${id}/tree`)
      .then(setTree)
      .catch((err) => setError(errorMessage(err)))
  }, [id])
  useEffect(load, [load])

  useEffect(() => {
    try {
      if (window.matchMedia(`(max-width: ${LIST_BELOW_PX - 1}px)`).matches) setView('list')
    } catch {
      // no matchMedia: keep the chart
    }
  }, [])

  const forest = useMemo(() => (tree ? buildFamilyTree(tree.nodes, tree.edges) : []), [tree])
  const query = search.trim().toLowerCase()
  const matches = useCallback((n: TreeNode) => !!query && fullName(n).toLowerCase().includes(query), [query])
  const relationOf = useMemo(() => relationLabels(tree?.edges ?? []), [tree])
  const describeRelation = (memberId: string) => {
    const r = relationOf.get(memberId)
    const other = r && tree?.nodes.find((n) => n.id === r.of)
    return r && other ? t('tree.relationOf', { relation: r.label, name: fullName(other) }) : undefined
  }
  const toggle = useCallback(
    (memberId: string) =>
      setCollapsed((prev) => {
        const next = new Set(prev)
        if (next.has(memberId)) next.delete(memberId)
        else next.add(memberId)
        return next
      }),
    [],
  )

  return (
    <>
      <div className="k-row k-row--between">
        <h1>{tree ? t('tree.titleOf', { family: tree.familyName }) : t('tree.title')}</h1>
        <Link href={`/family/${id}`} className="k-btn k-btn--secondary k-btn--sm">
          {t('tree.back')}
        </Link>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {!tree && !error && <ListSkeleton rows={4} />}
      {tree && tree.nodes.length === 0 && (
        <EmptyState
          title={t('tree.emptyTitle')}
          text={t('tree.emptyText')}
          action={
            <Link href={`/family/${id}/members/new`} className="k-btn">
              {t('tree.addMember')}
            </Link>
          }
        />
      )}

      {tree && tree.nodes.length > 0 && (
        <>
          <div className="lw-tree-tools k-row">
            <Tabs
              id={tabsId}
              label={t('tree.viewLabel')}
              active={view}
              onChange={setView}
              tabs={[
                { key: 'chart', label: t('tree.chart') },
                { key: 'list', label: t('tree.list') },
              ]}
            />
            <div className="k-field lw-tree-search">
              <label className="k-label k-sr-only" htmlFor={`${tabsId}-search`}>
                {t('tree.search')}
              </label>
              <input id={`${tabsId}-search`} className="k-input" type="search" placeholder={t('tree.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setCollapsed(new Set())}>
              {t('tree.expandAll')}
            </button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setCollapsed(new Set(branchIds(forest)))}>
              {t('tree.collapseAll')}
            </button>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm k-noprint" onClick={() => window.print()}>
              {t('tree.print')}
            </button>
          </div>
          <p className="k-muted k-small">{t('tree.legend')}</p>

          {view === 'chart' ? (
            <>
              <div {...tabPanelProps(tabsId, 'chart')} tabIndex={-1}>
                <Chart forest={forest} collapsed={collapsed} onToggle={toggle} onOpen={setSelected} matches={matches} t={t} />
              </div>
              {/* The same family as an outline with headings, always there for screen readers. */}
              <div className="k-sr-only">
                <TreeList forest={forest} t={t} />
              </div>
            </>
          ) : (
            <div {...tabPanelProps(tabsId, 'list')} tabIndex={-1}>
              <TreeList forest={forest} t={t} collapsed={collapsed} onToggle={toggle} onOpen={setSelected} matches={matches} />
            </div>
          )}
        </>
      )}

      <ProfileSheet member={selected} relation={selected ? describeRelation(selected.id) : undefined} onClose={() => setSelected(null)} />
    </>
  )
}

/** "Wife of Ramesh", "Son of Sunita": the first edge naming each member, for the list and the sheet. */
function relationLabels(edges: TreeEdge[]): Map<string, { label: string; of: string }> {
  const out = new Map<string, { label: string; of: string }>()
  for (const e of edges) if (e.relationshipLabel && !out.has(e.fromMemberId)) out.set(e.fromMemberId, { label: e.relationshipLabel, of: e.toMemberId })
  return out
}

interface UnitProps {
  collapsed: Set<string>
  onToggle: (id: string) => void
  onOpen: (n: TreeNode) => void
  matches: (n: TreeNode) => boolean
  t: Translate
}

/** A member's button in the chart: k-node, greyed with † when deceased, ringed when Karta. */
function NodeButton({ node, spouse, onOpen, matches, t }: { node: TreeNode; spouse?: boolean } & Pick<UnitProps, 'onOpen' | 'matches' | 't'>) {
  const classes = ['k-node', isExpired(node) && 'k-node--expired', spouse && 'k-node--spouse', node.isKarta && 'lw-node--karta', matches(node) && 'lw-node--match'].filter(Boolean).join(' ')
  return (
    <button type="button" className={classes} aria-haspopup="dialog" onClick={() => onOpen(node)} data-member={node.id}>
      <span>
        <span className="k-node__name">{fullName(node)}</span>
        {isExpired(node) && <span className="k-sr-only"> ({t('tree.deceased')})</span>}
        {(node.isKarta || spouse) && <span className="k-node__meta">{node.isKarta ? t('tree.karta') : t('tree.spouse')}</span>}
      </span>
    </button>
  )
}

function ChartUnit({ unit, ...props }: { unit: TreeUnit } & UnitProps) {
  const { collapsed, onToggle, t } = props
  const isCollapsed = collapsed.has(unit.member.id)
  const name = fullName(unit.member)
  return (
    <li>
      <div className="lw-unit">
        <NodeButton node={unit.member} {...props} />
        {unit.spouses.map((s) => (
          <span key={s.id} className="lw-unit__couple">
            <span className="lw-unit__ring" aria-hidden="true" />
            <NodeButton node={s} spouse {...props} />
          </span>
        ))}
      </div>
      {unit.marriedTo.length > 0 && <p className="k-node__meta lw-unit__also">{t('tree.marriedTo', { names: unit.marriedTo.map(fullName).join(', ') })}</p>}
      {/* On the line down to the children, so the couple stays centred over them. */}
      {unit.children.length > 0 && (
        <button
          type="button"
          className="lw-unit__toggle"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? t('tree.showChildren', { name, count: unit.children.length }) : t('tree.hideChildren', { name })}
          onClick={() => onToggle(unit.member.id)}
        >
          <Icon name={isCollapsed ? 'plus' : 'minus'} size={18} />
          {isCollapsed && <span className="lw-unit__count">{unit.children.reduce((s, c) => s + countMembers(c), 0)}</span>}
        </button>
      )}
      {unit.children.length > 0 && !isCollapsed && (
        <ul>
          {unit.children.map((c) => (
            <ChartUnit key={c.member.id} unit={c} {...props} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * The chart: zoom with the buttons or ctrl + wheel (a trackpad pinch), pan by
 * dragging or scrolling. It scrolls natively, so the keyboard reaches every
 * node and a focused node is scrolled into view.
 */
function Chart({ forest, ...props }: { forest: TreeUnit[] } & UnitProps) {
  const { t } = props
  const [zoom, setZoom] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function zoomBy(factor: number) {
    setZoom((z) => clampZoom(z * factor))
  }

  function onWheel(e: ReactWheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return // plain wheel scrolls
    e.preventDefault()
    setZoom((z) => clampZoom(z - e.deltaY * 0.002))
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse' || (e.target as HTMLElement).closest('button')) return
    const el = viewport.current!
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId }
    el.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    viewport.current!.scrollLeft = d.left - (e.clientX - d.x)
    viewport.current!.scrollTop = d.top - (e.clientY - d.y)
  }
  function onPointerUp() {
    drag.current = null
  }

  return (
    <div className="lw-chart" role="region" aria-label={t('tree.chartLabel')}>
      <div className="lw-chart__zoom k-row" role="group" aria-label={t('tree.zoom')}>
        <button type="button" className="k-btn k-btn--secondary k-btn--sm k-btn--icon" aria-label={t('tree.zoomOut')} onClick={() => zoomBy(1 / 1.2)} disabled={zoom <= MIN_ZOOM}>
          <Icon name="minus" size={18} />
        </button>
        <output className="lw-mono lw-chart__level" aria-live="polite">
          {Math.round(zoom * 100)}%
        </output>
        <button type="button" className="k-btn k-btn--secondary k-btn--sm k-btn--icon" aria-label={t('tree.zoomIn')} onClick={() => zoomBy(1.2)} disabled={zoom >= MAX_ZOOM}>
          <Icon name="plus" size={18} />
        </button>
        <button type="button" className="k-btn k-btn--ghost k-btn--sm" onClick={() => setZoom(1)}>
          {t('tree.zoomReset')}
        </button>
      </div>
      <div
        ref={viewport}
        className="lw-chart__viewport"
        tabIndex={0}
        aria-label={t('tree.chartScroll')}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="lw-chart__sizer" style={{ width: size.w * zoom, height: size.h * zoom }}>
          <div ref={canvas} className="lw-chart__canvas" style={{ transform: `scale(${zoom})` }}>
            {forest.map((root) => (
              <ul key={root.member.id} className="lw-tree">
                <ChartUnit unit={root} {...props} />
              </ul>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ListProps extends Partial<Omit<UnitProps, 't'>> {
  t: Translate
}

function ListName({ node, t, onOpen, matches }: { node: TreeNode } & ListProps) {
  const label = (
    <>
      <span className={isExpired(node) ? 'lw-expired' : undefined}>{fullName(node)}</span>
      {isExpired(node) && <span className="k-sr-only"> ({t('tree.deceased')})</span>}
      {node.isKarta && <span className="k-chip k-chip--accent k-chip--plain lw-list__chip">{t('tree.karta')}</span>}
    </>
  )
  return onOpen ? (
    <button type="button" className={`lw-list__name${matches?.(node) ? ' lw-node--match' : ''}`} aria-haspopup="dialog" onClick={() => onOpen(node)}>
      {label}
    </button>
  ) : (
    <span className="lw-list__name">{label}</span>
  )
}

function ListItem({ unit, ...props }: { unit: TreeUnit } & ListProps) {
  const { t, collapsed, onToggle, onOpen } = props
  const isCollapsed = !!collapsed?.has(unit.member.id)
  const name = fullName(unit.member)
  return (
    <li>
      <div className="lw-list__row">
        <ListName node={unit.member} {...props} />
        {unit.spouses.map((s) => (
          <span key={s.id} className="lw-list__spouse">
            <span className="k-muted">{t('tree.with')}</span> <ListName node={s} {...props} />
          </span>
        ))}
        {unit.marriedTo.length > 0 && <span className="k-muted k-small">{t('tree.marriedTo', { names: unit.marriedTo.map(fullName).join(', ') })}</span>}
        {onOpen && unit.children.length > 0 && (
          <button
            type="button"
            className="k-btn k-btn--ghost k-btn--sm"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? t('tree.showChildren', { name, count: unit.children.length }) : t('tree.hideChildren', { name })}
            onClick={() => onToggle?.(unit.member.id)}
          >
            {isCollapsed ? t('tree.childrenCount', { count: unit.children.length }) : t('tree.hide')}
          </button>
        )}
      </div>
      {unit.children.length > 0 && !isCollapsed && (
        <ul aria-label={t('tree.childrenOf', { name })}>
          {unit.children.map((c) => (
            <ListItem key={c.member.id} unit={c} {...props} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * The list view: each branch under its own heading, generations as nested
 * lists. Interactive when shown (tap a name for the profile, fold a branch);
 * plain text in its screen-reader-only copy beside the chart.
 */
function TreeList({ forest, ...props }: { forest: TreeUnit[] } & ListProps) {
  const { t } = props
  const headingId = useId()
  return (
    <section className="lw-list" aria-labelledby={headingId}>
      <h2 id={headingId} className="lw-h3">
        {t('tree.listTitle')}
      </h2>
      {forest.map((root) => (
        <section key={root.member.id} className="lw-list__branch" aria-labelledby={`${headingId}-${root.member.id}`}>
          <h3 id={`${headingId}-${root.member.id}`} className="lw-list__heading">
            {t('tree.branchOf', { name: fullName(root.member) })} · {t('tree.members', { count: countMembers(root) })}
          </h3>
          <ul>
            <ListItem unit={root} {...props} />
          </ul>
        </section>
      ))}
    </section>
  )
}

/** Tap a member: their profile in a k-dialog (a bottom sheet on phones). */
function ProfileSheet({ member, relation, onClose }: { member: TreeNode | null; relation?: string; onClose: () => void }) {
  const t = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const el = dialog.current
    if (!el || !member || el.open) return
    const opener = document.activeElement
    const runtime = kesari()
    if (runtime) runtime.openDialog(el, opener)
    else if (typeof el.showModal === 'function') el.showModal()
    else el.setAttribute('open', '')
  }, [member])

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    const closed = () => onClose()
    el.addEventListener('close', closed)
    return () => el.removeEventListener('close', closed)
  }, [onClose])

  const close = () => dialog.current?.close()
  const place = member ? [member.currentCity, member.currentState].filter(Boolean).join(', ') : ''

  return (
    <dialog ref={dialog} className="k-dialog" aria-labelledby={titleId}>
      {member && (
        <>
          <div className="k-dialog__head">
            <h2 id={titleId}>
              <span className={isExpired(member) ? 'lw-expired' : undefined}>{fullName(member)}</span>
              {isExpired(member) && <span className="k-sr-only"> ({t('tree.deceased')})</span>}
            </h2>
            <button type="button" className="k-btn k-btn--ghost k-btn--sm" data-k-close onClick={close}>
              {t('tree.close')}
            </button>
          </div>
          <div className="k-dialog__body">
            <dl className="lw-facts">
              <div>
                <dt>{t('tree.status')}</dt>
                <dd>
                  <StatusPill status={member.status} />
                  {member.isKarta && <span className="k-chip k-chip--accent k-chip--plain">{t('tree.karta')}</span>}
                </dd>
              </div>
              {relation && (
                <div>
                  <dt>{t('tree.relation')}</dt>
                  <dd>{relation}</dd>
                </div>
              )}
              {hasMessage(`gender.${member.gender}`) && (
                <div>
                  <dt>{t('field.gender')}</dt>
                  <dd>{t(`gender.${member.gender}` as 'gender.MALE')}</dd>
                </div>
              )}
              {member.dateOfBirth && (
                <div>
                  <dt>{t('field.dateOfBirth')}</dt>
                  <dd>{formatDate(member.dateOfBirth)}</dd>
                </div>
              )}
              {place && (
                <div>
                  <dt>{t('tree.lives')}</dt>
                  <dd>{place}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="k-dialog__foot">
            <Link href={`/members/${member.id}`} className="k-btn">
              {t('tree.fullProfile')}
            </Link>
          </div>
        </>
      )}
    </dialog>
  )
}
