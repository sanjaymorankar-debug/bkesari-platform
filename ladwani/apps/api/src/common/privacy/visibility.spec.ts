import { canView, filterFields } from './visibility'

describe('canView', () => {
  it('PUBLIC is visible to anyone, including unauthenticated viewers', () => {
    expect(canView('PUBLIC', { isAuthenticated: false }, {})).toBe(true)
  })

  it('REGISTERED_COMMUNITY requires authentication only', () => {
    expect(canView('REGISTERED_COMMUNITY', { isAuthenticated: false }, {})).toBe(false)
    expect(canView('REGISTERED_COMMUNITY', { isAuthenticated: true }, {})).toBe(true)
  })

  it('SAME_AREA requires an overlapping area and authentication', () => {
    const owner = { areaIds: ['pune'] }
    expect(canView('SAME_AREA', { isAuthenticated: true, areaIds: ['mumbai'] }, owner)).toBe(false)
    expect(canView('SAME_AREA', { isAuthenticated: true, areaIds: ['pune'] }, owner)).toBe(true)
    expect(canView('SAME_AREA', { isAuthenticated: false, areaIds: ['pune'] }, owner)).toBe(false)
  })

  it('SAME_FAMILY requires an overlapping family and authentication', () => {
    const owner = { familyIds: ['fam_1'] }
    expect(canView('SAME_FAMILY', { isAuthenticated: true, familyIds: ['fam_2'] }, owner)).toBe(false)
    expect(canView('SAME_FAMILY', { isAuthenticated: true, familyIds: ['fam_1'] }, owner)).toBe(true)
  })

  it('MATRIMONY_ONLY is never visible via the base resolver (must be handled by the matrimony module)', () => {
    expect(canView('MATRIMONY_ONLY', { isAuthenticated: true, userId: 'u1' }, { userId: 'u1' })).toBe(false)
  })

  it('ADMIN_OPERATOR is visible to Admin unconditionally', () => {
    expect(canView('ADMIN_OPERATOR', { isAuthenticated: true, roles: ['ADMIN'] }, {})).toBe(true)
  })

  it('ADMIN_OPERATOR is visible to Operator only within their scoped area', () => {
    const owner = { operatorAreaIds: ['pune'] }
    expect(canView('ADMIN_OPERATOR', { isAuthenticated: true, roles: ['OPERATOR'], areaIds: ['mumbai'] }, owner)).toBe(false)
    expect(canView('ADMIN_OPERATOR', { isAuthenticated: true, roles: ['OPERATOR'], areaIds: ['pune'] }, owner)).toBe(true)
  })

  it('ADMIN_OPERATOR is not visible to a plain Member', () => {
    expect(canView('ADMIN_OPERATOR', { isAuthenticated: true, roles: ['MEMBER'] }, {})).toBe(false)
  })

  it('PRIVATE is visible only to the owner themself', () => {
    expect(canView('PRIVATE', { isAuthenticated: true, userId: 'u1' }, { userId: 'u1' })).toBe(true)
    expect(canView('PRIVATE', { isAuthenticated: true, userId: 'u2' }, { userId: 'u1' })).toBe(false)
    expect(canView('PRIVATE', { isAuthenticated: false }, { userId: 'u1' })).toBe(false)
  })

  it('PRIVATE never leaks via Karta/family relation alone — a hard rule from docs/09 and docs/17', () => {
    // Same family, but viewer is not the owner: PRIVATE must still say no.
    // (Karta authority does not override an adult member's own PRIVATE fields.)
    const owner = { userId: 'member-owner', familyIds: ['fam_1'] }
    const kartaViewer = { isAuthenticated: true, userId: 'karta-user', familyIds: ['fam_1'], roles: ['KARTA'] }
    expect(canView('PRIVATE', kartaViewer, owner)).toBe(false)
  })
})

describe('filterFields', () => {
  const record = { name: 'Ramesh', mobile: '9876543210', city: 'Pune' }

  it('omits a field with no declared visibility rule rather than leaking it', () => {
    const result = filterFields(record, { name: 'PUBLIC' }, { isAuthenticated: false }, {})
    expect(result).toEqual({ name: 'Ramesh' })
    expect(result.mobile).toBeUndefined()
    expect('mobile' in result).toBe(false)
  })

  it('applies per-field visibility independently', () => {
    const rules = { name: 'PUBLIC', mobile: 'PRIVATE', city: 'REGISTERED_COMMUNITY' } as const
    const owner = { userId: 'owner-1' }

    const anonymous = filterFields(record, rules, { isAuthenticated: false }, owner)
    expect(anonymous).toEqual({ name: 'Ramesh' })

    const loggedInStranger = filterFields(record, rules, { isAuthenticated: true, userId: 'someone-else' }, owner)
    expect(loggedInStranger).toEqual({ name: 'Ramesh', city: 'Pune' })

    const ownerViewingSelf = filterFields(record, rules, { isAuthenticated: true, userId: 'owner-1' }, owner)
    expect(ownerViewingSelf).toEqual({ name: 'Ramesh', mobile: '9876543210', city: 'Pune' })
  })
})
