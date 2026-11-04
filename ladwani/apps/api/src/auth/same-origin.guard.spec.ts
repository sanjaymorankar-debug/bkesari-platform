import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { isCrossSiteRequest, SameOriginGuard } from './same-origin.guard'
import { AuthController } from './auth.controller'
import { SignUpController } from './sign-up.controller'

const req = (headers: Record<string, string>) => ({ headers })

describe('isCrossSiteRequest', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('passes a request with no Origin (same-origin GET, curl, a server)', () => {
    expect(isCrossSiteRequest(req({ host: 'bkesari.com' }))).toBe(false)
  })

  it('passes an Origin naming the Host, port included', () => {
    expect(isCrossSiteRequest(req({ host: 'bkesari.com', origin: 'https://bkesari.com' }))).toBe(false)
    expect(isCrossSiteRequest(req({ host: 'localhost:4000', origin: 'http://localhost:4000' }))).toBe(false)
    expect(isCrossSiteRequest(req({ host: 'localhost:4000', origin: 'http://localhost:5000' }))).toBe(true)
  })

  it('refuses another site, a sibling subdomain, and the opaque "null" origin', () => {
    expect(isCrossSiteRequest(req({ host: 'bkesari.com', origin: 'https://evil.example' }))).toBe(true)
    expect(isCrossSiteRequest(req({ host: 'bkesari.com', origin: 'https://dev.bkesari.com' }))).toBe(true)
    expect(isCrossSiteRequest(req({ host: 'bkesari.com', origin: 'null' }))).toBe(true)
    expect(isCrossSiteRequest(req({ host: 'bkesari.com', origin: 'not a url' }))).toBe(true)
  })

  it('refuses Sec-Fetch-Site: cross-site even without an Origin', () => {
    expect(isCrossSiteRequest(req({ host: 'bkesari.com', 'sec-fetch-site': 'cross-site' }))).toBe(true)
    expect(isCrossSiteRequest(req({ host: 'bkesari.com', 'sec-fetch-site': 'same-origin' }))).toBe(false)
  })

  it('passes the host a proxy in front names (the next dev rewrite) and WEB_ORIGIN', () => {
    expect(isCrossSiteRequest(req({ host: 'localhost:4000', 'x-forwarded-host': 'localhost:3000', origin: 'http://localhost:3000' }))).toBe(false)
    process.env.WEB_ORIGIN = 'https://app.example'
    expect(isCrossSiteRequest(req({ host: 'api.example', origin: 'https://app.example' }))).toBe(false)
  })

  it('in production trusts no default WEB_ORIGIN', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.WEB_ORIGIN
    delete process.env.LADWANI_WEB_ORIGIN
    expect(isCrossSiteRequest(req({ host: 'bkesari.com', origin: 'http://localhost:3000' }))).toBe(true)
  })
})

describe('SameOriginGuard', () => {
  const ctx = (headers: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext

  it('throws 403 for a cross-site request', () => {
    expect(() => new SameOriginGuard().canActivate(ctx({ host: 'bkesari.com', origin: 'https://evil.example' }))).toThrow(ForbiddenException)
    expect(new SameOriginGuard().canActivate(ctx({ host: 'bkesari.com', origin: 'https://bkesari.com' }))).toBe(true)
  })

  it('guards every auth route, the sign-up ones included', () => {
    for (const controller of [AuthController, SignUpController]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(SameOriginGuard)
    }
  })
})
