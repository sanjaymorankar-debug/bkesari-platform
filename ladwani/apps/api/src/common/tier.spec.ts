import { currentTier, mayShowCodes } from './tier'

describe('currentTier', () => {
  it('reads APP_ENV and its long spellings, and calls blank local', () => {
    expect(currentTier('dev')).toBe('dev')
    expect(currentTier(' Development ')).toBe('dev')
    expect(currentTier('test')).toBe('test')
    expect(currentTier('staging')).toBe('test')
    expect(currentTier('prod')).toBe('prod')
    expect(currentTier('PRODUCTION')).toBe('prod')
    expect(currentTier(undefined)).toBe('local')
    expect(currentTier('  ')).toBe('local')
    expect(currentTier('qa')).toBe('unknown')
  })
})

describe('mayShowCodes (a code on screen when nothing can deliver it)', () => {
  const cases: [Record<string, string | undefined>, boolean][] = [
    // The dev tier, whatever NODE_ENV says (the hub runs every tier with NODE_ENV=production).
    [{ APP_ENV: 'dev', NODE_ENV: 'production' }, true],
    [{ APP_ENV: 'dev' }, true],
    // A local run: APP_ENV unset and not NODE_ENV=production.
    [{ NODE_ENV: 'test' }, true],
    [{ NODE_ENV: 'development' }, true],
    [{}, true],
    [{ APP_ENV: '', NODE_ENV: 'production' }, false],
    // Never on test or production, whatever NODE_ENV says.
    [{ APP_ENV: 'test', NODE_ENV: 'development' }, false],
    [{ APP_ENV: 'test' }, false],
    [{ APP_ENV: 'staging' }, false],
    [{ APP_ENV: 'prod', NODE_ENV: 'test' }, false],
    [{ APP_ENV: 'production' }, false],
    // A spelling this API does not know is treated like production.
    [{ APP_ENV: 'qa', NODE_ENV: 'development' }, false],
  ]
  it.each(cases)('%j -> %s', (env, expected) => {
    expect(mayShowCodes(env as NodeJS.ProcessEnv)).toBe(expected)
  })

  it('reads process.env by default', () => {
    const saved = { ...process.env }
    try {
      process.env.APP_ENV = 'test'
      expect(mayShowCodes()).toBe(false)
      process.env.APP_ENV = 'dev'
      expect(mayShowCodes()).toBe(true)
    } finally {
      process.env = saved
    }
  })
})
