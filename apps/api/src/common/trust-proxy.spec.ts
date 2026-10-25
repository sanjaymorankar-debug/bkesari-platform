import { trustProxySetting } from './trust-proxy'

describe('trustProxySetting', () => {
  it('trusts nothing when unset or blank, as before', () => {
    expect(trustProxySetting(undefined)).toBeUndefined()
    expect(trustProxySetting('  ')).toBeUndefined()
  })

  it('passes an address list through for Express to parse', () => {
    expect(trustProxySetting('loopback, 203.0.113.10')).toBe('loopback, 203.0.113.10')
  })

  it('reads a hop count as a number and true/false as booleans', () => {
    expect(trustProxySetting('3')).toBe(3)
    expect(trustProxySetting('true')).toBe(true)
    expect(trustProxySetting('false')).toBe(false)
  })
})
