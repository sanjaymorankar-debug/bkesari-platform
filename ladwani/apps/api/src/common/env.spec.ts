import { env } from './env'

describe('env', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('prefers LADWANI_<name>, so the hub process can carry its own DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgres://hub'
    process.env.LADWANI_DATABASE_URL = 'postgres://ladwani'
    expect(env('DATABASE_URL')).toBe('postgres://ladwani')
  })

  it('falls back to the plain name when LadWani runs on its own', () => {
    delete process.env.LADWANI_JWT_SECRET
    process.env.JWT_SECRET = 'plain'
    expect(env('JWT_SECRET')).toBe('plain')
  })
})
