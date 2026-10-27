import { withConnectionDefaults } from './prisma.service'

describe('withConnectionDefaults', () => {
  it('adds the idle lifetime, connect timeout and pool size to a Neon URL, keeping what is there', () => {
    const out = new URL(
      withConnectionDefaults('postgresql://app:p%40ss@ep-x-pooler.ap-southeast-1.aws.neon.tech/bk_ladwani?sslmode=require&channel_binding=require')!,
    )
    expect(out.searchParams.get('max_idle_connection_lifetime')).toBe('30')
    expect(out.searchParams.get('connect_timeout')).toBe('15')
    expect(out.searchParams.get('connection_limit')).toBe('5')
    expect(out.searchParams.get('sslmode')).toBe('require')
    expect(out.searchParams.get('channel_binding')).toBe('require')
    expect(out.password).toBe('p%40ss')
    expect(out.host).toBe('ep-x-pooler.ap-southeast-1.aws.neon.tech')
    expect(out.pathname).toBe('/bk_ladwani')
  })

  it('leaves a value the URL already sets', () => {
    const out = new URL(withConnectionDefaults('postgresql://u:p@localhost:5432/db?connect_timeout=5&connection_limit=12')!)
    expect(out.searchParams.get('connect_timeout')).toBe('5')
    expect(out.searchParams.get('connection_limit')).toBe('12')
    expect(out.searchParams.get('max_idle_connection_lifetime')).toBe('30')
  })

  it('passes an unset or malformed URL through for Prisma to report', () => {
    expect(withConnectionDefaults(undefined)).toBeUndefined()
    expect(withConnectionDefaults('not a url')).toBe('not a url')
  })
})
