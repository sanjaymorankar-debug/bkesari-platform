export interface TreeNode {
  id: string
  firstName: string
  lastName: string | null
  gender: string
  status: string
  isKarta: boolean
}

export interface TreeEdge {
  fromMemberId: string
  toMemberId: string
  relationshipCode: string
}

export interface PositionedNode extends TreeNode {
  generation: number
  col: number
}

const PARENT_CODES = new Set(['father', 'mother', 'grandfather_p', 'grandmother_p'])
const CHILD_CODES = new Set(['son', 'daughter', 'grandson', 'granddaughter'])
const SPOUSE_CODES = new Set(['husband', 'wife'])

/**
 * Assigns each member a relative generation via BFS over parent/child edges
 * (ancestors negative, descendants positive, Karta or first node as anchor),
 * places spouses alongside their partner, and lays out remaining unconnected
 * members in their own row. This is a heuristic layout for display, not a
 * canonical genealogical chart algorithm.
 */
export function layoutTree(nodes: TreeNode[], edges: TreeEdge[]): PositionedNode[] {
  const parentOf = new Map<string, Set<string>>()
  const spouseOf = new Map<string, Set<string>>()

  const addParent = (childId: string, parentId: string) => {
    if (!parentOf.has(childId)) parentOf.set(childId, new Set())
    parentOf.get(childId)!.add(parentId)
  }

  for (const e of edges) {
    if (PARENT_CODES.has(e.relationshipCode)) addParent(e.toMemberId, e.fromMemberId)
    else if (CHILD_CODES.has(e.relationshipCode)) addParent(e.fromMemberId, e.toMemberId)
    else if (SPOUSE_CODES.has(e.relationshipCode)) {
      if (!spouseOf.has(e.fromMemberId)) spouseOf.set(e.fromMemberId, new Set())
      spouseOf.get(e.fromMemberId)!.add(e.toMemberId)
    }
  }

  const childrenOf = new Map<string, Set<string>>()
  for (const [child, parents] of Array.from(parentOf.entries())) {
    for (const parent of Array.from(parents)) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, new Set())
      childrenOf.get(parent)!.add(child)
    }
  }

  const generation = new Map<string, number>()
  const anchor = nodes.find((n) => n.isKarta)?.id ?? nodes[0]?.id
  if (anchor) {
    generation.set(anchor, 0)
    const queue = [anchor]
    while (queue.length) {
      const current = queue.shift()!
      const gen = generation.get(current)!
      for (const parent of Array.from(parentOf.get(current) ?? [])) {
        if (!generation.has(parent)) {
          generation.set(parent, gen - 1)
          queue.push(parent)
        }
      }
      for (const child of Array.from(childrenOf.get(current) ?? [])) {
        if (!generation.has(child)) {
          generation.set(child, gen + 1)
          queue.push(child)
        }
      }
      for (const spouse of Array.from(spouseOf.get(current) ?? [])) {
        if (!generation.has(spouse)) {
          generation.set(spouse, gen)
          queue.push(spouse)
        }
      }
    }
  }

  const generationValues = Array.from(generation.values())
  const minGen = Math.min(0, ...generationValues)
  const byGeneration = new Map<number, TreeNode[]>()
  let nextUnconnectedGen = (generationValues.length ? Math.max(...generationValues) : 0) + 2

  for (const node of nodes) {
    const gen = generation.has(node.id) ? generation.get(node.id)! - minGen : nextUnconnectedGen++
    if (!byGeneration.has(gen)) byGeneration.set(gen, [])
    byGeneration.get(gen)!.push(node)
  }

  const positioned: PositionedNode[] = []
  for (const [gen, members] of Array.from(byGeneration.entries()).sort((a, b) => a[0] - b[0])) {
    members.forEach((node, col) => positioned.push({ ...node, generation: gen, col }))
  }
  return positioned
}
