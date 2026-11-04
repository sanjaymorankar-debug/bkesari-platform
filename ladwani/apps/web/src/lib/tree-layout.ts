export interface TreeNode {
  id: string
  firstName: string
  middleName?: string | null
  lastName: string | null
  gender: string
  status: string
  isKarta: boolean
  left?: boolean
  dateOfBirth?: string | null
  maritalStatus?: string | null
  currentCity?: string | null
  currentState?: string | null
}

export interface TreeEdge {
  fromMemberId: string
  toMemberId: string
  relationshipCode: string
  relationshipLabel?: string
}

/**
 * One box of the tree: a member, the spouse(s) drawn beside them, and their
 * children's units below. `marriedTo` names spouses drawn elsewhere (in their
 * own parents' branch), so the link is never lost.
 */
export interface TreeUnit {
  member: TreeNode
  spouses: TreeNode[]
  marriedTo: TreeNode[]
  children: TreeUnit[]
}

// "A is father of B": the edge goes from the parent. "A is son of B": from the child.
const PARENT_CODES = new Set(['father', 'mother'])
const CHILD_CODES = new Set(['son', 'daughter'])
// Used only when a member has no parent in the family: drawn under the grandparent.
const GRANDPARENT_CODES = new Set(['grandfather_p', 'grandmother_p'])
const GRANDCHILD_CODES = new Set(['grandson', 'granddaughter'])
const SPOUSE_CODES = new Set(['husband', 'wife'])

export const fullName = (n: Pick<TreeNode, 'firstName' | 'lastName'>) => `${n.firstName} ${n.lastName ?? ''}`.trim()
export const isExpired = (n: Pick<TreeNode, 'status'>) => n.status === 'DECEASED'

function add(map: Map<string, Set<string>>, key: string, value: string) {
  if (!map.has(key)) map.set(key, new Set())
  map.get(key)!.add(value)
}

/**
 * The family as a forest of units, for both the chart and the list view.
 * Roots are the members with no parent in the family (a spouse who married in
 * hangs beside their partner instead); the Karta's branch comes first. Members
 * the edges do not reach (siblings only, or a cycle) become their own roots,
 * so nobody is ever left out. A heuristic for display, not a canonical
 * genealogical chart.
 */
export function buildFamilyTree(nodes: TreeNode[], edges: TreeEdge[]): TreeUnit[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const parents = new Map<string, Set<string>>()
  const grandparents = new Map<string, Set<string>>()
  const spouses = new Map<string, Set<string>>()

  for (const e of edges) {
    if (!byId.has(e.fromMemberId) || !byId.has(e.toMemberId) || e.fromMemberId === e.toMemberId) continue
    if (PARENT_CODES.has(e.relationshipCode)) add(parents, e.toMemberId, e.fromMemberId)
    else if (CHILD_CODES.has(e.relationshipCode)) add(parents, e.fromMemberId, e.toMemberId)
    else if (GRANDPARENT_CODES.has(e.relationshipCode)) add(grandparents, e.toMemberId, e.fromMemberId)
    else if (GRANDCHILD_CODES.has(e.relationshipCode)) add(grandparents, e.fromMemberId, e.toMemberId)
    else if (SPOUSE_CODES.has(e.relationshipCode)) {
      add(spouses, e.fromMemberId, e.toMemberId)
      add(spouses, e.toMemberId, e.fromMemberId)
    }
  }
  // Grandparents stand in only for a member with no parent recorded.
  grandparents.forEach((gps, child) => {
    if (!parents.has(child)) gps.forEach((gp) => add(parents, child, gp))
  })

  const children = new Map<string, Set<string>>()
  parents.forEach((ps, child) => ps.forEach((p) => add(children, p, child)))

  const hasParent = (id: string) => (parents.get(id)?.size ?? 0) > 0
  const spousesOf = (id: string) => Array.from(spouses.get(id) ?? [])
  const byName = (a: string, b: string) => fullName(byId.get(a)!).localeCompare(fullName(byId.get(b)!))
  const placed = new Set<string>()

  function unit(id: string): TreeUnit {
    placed.add(id)
    const beside = spousesOf(id).filter((s) => !placed.has(s) && !hasParent(s))
    beside.forEach((s) => placed.add(s))
    const kids = new Set<string>()
    for (const parent of [id, ...beside]) children.get(parent)?.forEach((c) => kids.add(c))
    const childIds = Array.from(kids).filter((c) => !placed.has(c)).sort(byName)
    childIds.forEach((c) => placed.add(c))
    return {
      member: byId.get(id)!,
      spouses: beside.map((s) => byId.get(s)!),
      marriedTo: spousesOf(id)
        .filter((s) => !beside.includes(s))
        .map((s) => byId.get(s)!),
      children: childIds.map((c) => {
        placed.delete(c)
        return unit(c)
      }),
    }
  }

  // A root that married in someone with parents here hangs beside them instead.
  const isRoot = (id: string) => !hasParent(id) && !spousesOf(id).some(hasParent)
  const karta = nodes.find((n) => n.isKarta)?.id
  const ancestorsOf = (id: string, seen = new Set<string>()): Set<string> => {
    parents.get(id)?.forEach((p) => {
      if (!seen.has(p)) {
        seen.add(p)
        ancestorsOf(p, seen)
      }
    })
    return seen
  }
  const kartaLine = karta ? ancestorsOf(karta).add(karta) : new Set<string>()
  const rootIds = nodes
    .map((n) => n.id)
    .filter(isRoot)
    .sort((a, b) => Number(kartaLine.has(b)) - Number(kartaLine.has(a)) || byName(a, b))

  const forest: TreeUnit[] = []
  for (const id of rootIds) if (!placed.has(id)) forest.push(unit(id))
  for (const n of nodes) if (!placed.has(n.id)) forest.push(unit(n.id))
  return forest
}

/** How many members a unit draws, its own and its descendants'. */
export function countMembers(u: TreeUnit): number {
  return 1 + u.spouses.length + u.children.reduce((sum, c) => sum + countMembers(c), 0)
}

/** Every unit id that has children, for "expand all / collapse all". */
export function branchIds(forest: TreeUnit[]): string[] {
  const out: string[] = []
  const walk = (u: TreeUnit) => {
    if (u.children.length) out.push(u.member.id)
    u.children.forEach(walk)
  }
  forest.forEach(walk)
  return out
}
