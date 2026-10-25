import { canViewMatrimonyProfile } from './matrimony-visibility'

describe('canViewMatrimonyProfile', () => {
  it('is never visible to an unauthenticated viewer, even if the profile is visible', () => {
    expect(canViewMatrimonyProfile({ isAuthenticated: false }, { isVisible: true })).toBe(false)
  })

  it('is never visible to a registered viewer when the profile owner has not opted in', () => {
    expect(canViewMatrimonyProfile({ isAuthenticated: true, userId: 'u1' }, { isVisible: false, userId: 'u2' })).toBe(false)
  })

  it('is visible to any authenticated viewer once the owner has opted in', () => {
    expect(canViewMatrimonyProfile({ isAuthenticated: true, userId: 'u1' }, { isVisible: true, userId: 'u2' })).toBe(true)
  })

  it("is always visible to the profile's own owner, even while not opted in to being discoverable", () => {
    expect(canViewMatrimonyProfile({ isAuthenticated: true, userId: 'u1' }, { isVisible: false, userId: 'u1' })).toBe(true)
  })

  it('never leaks a hidden profile to a stranger just because they are logged in', () => {
    expect(canViewMatrimonyProfile({ isAuthenticated: true, userId: 'stranger' }, { isVisible: false, userId: 'owner' })).toBe(false)
  })
})
