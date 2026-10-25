'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '../../../../lib/api-client'
import { errorMessage } from '../../../../lib/auth-context'
import { layoutTree, type TreeNode, type TreeEdge } from '../../../../lib/tree-layout'
import { RequireAuth, TopBar, Shell, ErrorBanner, Avatar } from '../../../../components/ui'

interface TreeResponse {
  familyId: string
  familyName: string
  nodes: TreeNode[]
  edges: TreeEdge[]
}

const NODE_WIDTH = 160
const NODE_HEIGHT = 84
const COL_GAP = 40
const ROW_GAP = 100

export default function FamilyTreePage() {
  const { id } = useParams<{ id: string }>()
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set())
  const dragging = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  useEffect(() => {
    api
      .get<TreeResponse>(`/families/${id}/tree`)
      .then(setTree)
      .catch((err) => setError(errorMessage(err)))
  }, [id])

  const positioned = useMemo(() => (tree ? layoutTree(tree.nodes, tree.edges) : []), [tree])

  useEffect(() => {
    if (!search.trim()) {
      setHighlighted(new Set())
      return
    }
    const q = search.trim().toLowerCase()
    const matches = positioned.filter((n) => `${n.firstName} ${n.lastName ?? ''}`.toLowerCase().includes(q))
    setHighlighted(new Set(matches.map((m) => m.id)))
  }, [search, positioned])

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    setZoom((z) => Math.min(2, Math.max(0.4, z - e.deltaY * 0.001)))
  }

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return
    const dx = e.clientX - dragging.current.startX
    const dy = e.clientY - dragging.current.startY
    setPan({ x: dragging.current.panX + dx, y: dragging.current.panY + dy })
  }
  function onMouseUp() {
    dragging.current = null
  }

  return (
    <RequireAuth>
      <TopBar />
      <div className="topbar" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="row">
          <Link href={`/family/${id}`} className="btn btn-outline">
            ← Back
          </Link>
          <h3 style={{ margin: 0 }}>{tree?.familyName ?? 'Family tree'}</h3>
        </div>
        <div className="row">
          <input placeholder="Search members…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200 }} />
          <button className="btn btn-outline" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}>
            −
          </button>
          <span className="mono muted" style={{ width: 44, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button className="btn btn-outline" onClick={() => setZoom((z) => Math.min(2, z + 0.15))}>
            +
          </button>
          <button className="btn btn-outline" onClick={() => window.print()}>
            Export / Print
          </button>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        <ErrorBanner message={error} />
      </div>

      <div
        style={{ width: '100%', height: 'calc(100vh - 140px)', overflow: 'hidden', cursor: dragging.current ? 'grabbing' : 'grab', background: 'var(--bg)' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            position: 'relative',
            width: 4000,
            height: 2000,
          }}
        >
          {positioned.map((node) => (
            <div
              key={node.id}
              className="card"
              style={{
                position: 'absolute',
                left: node.col * (NODE_WIDTH + COL_GAP),
                top: node.generation * (NODE_HEIGHT + ROW_GAP),
                width: NODE_WIDTH,
                padding: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                borderColor: highlighted.has(node.id) ? 'var(--accent)' : 'var(--border)',
                borderWidth: highlighted.has(node.id) ? 2 : 1,
              }}
            >
              <Avatar name={`${node.firstName} ${node.lastName ?? ''}`} deceased={node.status === 'DECEASED'} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {node.firstName} {node.lastName ?? ''}
                </div>
                {node.isKarta && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Karta
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </RequireAuth>
  )
}
