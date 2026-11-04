import { appBase, cookiePath, isPlainHttpLocalhost, sessionCookieOptions } from './session-cookie'

describe('session cookie settings', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('is scoped to /ladwani unless LADWANI_COOKIE_PATH says otherwise', () => {
    delete process.env.LADWANI_COOKIE_PATH
    delete process.env.COOKIE_PATH
    expect(cookiePath()).toBe('/ladwani')
    expect(appBase()).toBe('/ladwani')
    process.env.LADWANI_COOKIE_PATH = '/'
    expect(cookiePath()).toBe('/')
    expect(appBase()).toBe('')
    process.env.LADWANI_COOKIE_PATH = '/family-app/'
    expect(cookiePath()).toBe('/family-app')
    process.env.LADWANI_COOKIE_PATH = 'no-slash'
    expect(cookiePath()).toBe('/ladwani')
  })

  it('is Secure everywhere but plain http to this machine', () => {
    expect(isPlainHttpLocalhost({ protocol: 'http', hostname: 'localhost' })).toBe(true)
    expect(isPlainHttpLocalhost({ protocol: 'http', hostname: '127.0.0.1' })).toBe(true)
    expect(isPlainHttpLocalhost({ protocol: 'https', hostname: 'localhost' })).toBe(false)
    expect(isPlainHttpLocalhost({ protocol: 'http', hostname: 'bkesari.com' })).toBe(false)
    delete process.env.LADWANI_COOKIE_PATH
    expect(sessionCookieOptions({ protocol: 'http', hostname: 'dev.bkesari.com' })).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/ladwani' })
  })
})
