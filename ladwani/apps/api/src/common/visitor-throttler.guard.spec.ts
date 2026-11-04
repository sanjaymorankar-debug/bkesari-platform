import { VisitorThrottlerGuard, clientAddress } from './visitor-throttler.guard'

describe('VisitorThrottlerGuard', () => {
  const saved = { ...process.env }
  const guard = Object.create(VisitorThrottlerGuard.prototype) as VisitorThrottlerGuard
  const tracker = (req: Record<string, any>) => (guard as any).getTracker(req) as Promise<string>
  afterEach(() => {
    process.env = { ...saved }
  })

  it('counts per signed-in person when the hub names the visitor header', async () => {
    process.env.LADWANI_VISITOR_HEADER = 'X-Bkesari-Visitor'
    expect(await tracker({ ip: '10.0.0.1', headers: { 'x-bkesari-visitor': 'hub-asha' } })).toBe('visitor:hub-asha')
    expect(await tracker({ ip: '10.0.0.1', headers: { 'x-bkesari-visitor': 'hub-ravi' } })).toBe('visitor:hub-ravi')
  })

  it('ignores such a header when not running inside the hub', async () => {
    delete process.env.LADWANI_VISITOR_HEADER
    delete process.env.VISITOR_HEADER
    expect(await tracker({ ip: '10.0.0.1', headers: { 'x-bkesari-visitor': 'spoofed' } })).toBe('10.0.0.1')
  })

  it('falls back to the client IP when the header is missing', async () => {
    process.env.LADWANI_VISITOR_HEADER = 'x-bkesari-visitor'
    expect(await tracker({ ip: '10.0.0.2', headers: {} })).toBe('10.0.0.2')
  })
})

describe('clientAddress (the built-in sign-in limits)', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it("is the address the hub names, without its 'ip:' prefix", () => {
    process.env.LADWANI_VISITOR_HEADER = 'x-bkesari-visitor'
    expect(clientAddress({ ip: '127.0.0.1', headers: { 'x-bkesari-visitor': 'ip:203.0.113.7' } })).toBe('203.0.113.7')
  })

  it('is the client IP when the header is not trusted or not sent', () => {
    delete process.env.LADWANI_VISITOR_HEADER
    delete process.env.VISITOR_HEADER
    expect(clientAddress({ ip: '10.0.0.1', headers: { 'x-bkesari-visitor': 'ip:6.6.6.6' } })).toBe('10.0.0.1')
    process.env.LADWANI_VISITOR_HEADER = 'x-bkesari-visitor'
    expect(clientAddress({ ip: '10.0.0.2', headers: {} })).toBe('10.0.0.2')
  })

  it("is 'unknown' with no address at all, and never longer than an IPv6 address", () => {
    delete process.env.LADWANI_VISITOR_HEADER
    expect(clientAddress({ headers: {} })).toBe('unknown')
    process.env.LADWANI_VISITOR_HEADER = 'x-bkesari-visitor'
    expect(clientAddress({ headers: { 'x-bkesari-visitor': `ip:${'a'.repeat(100)}` } })).toHaveLength(45)
  })
})
