import { VisitorThrottlerGuard } from './visitor-throttler.guard'

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
