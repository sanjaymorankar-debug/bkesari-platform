import { generateKeyPairSync, sign, createHash } from 'crypto'
import { ConflictException, UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { HubJwks, HubTokenError, verifyHubToken } from './hub-token'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const kid = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16)
const jwks = { keys: [{ ...(publicKey.export({ format: 'jwk' }) as Record<string, string>), kid, alg: 'RS256', use: 'sig' }] }

function token(claims: Record<string, unknown>, opts: { exp?: number; key?: typeof privateKey; kid?: string } = {}) {
  const iat = Math.floor(Date.now() / 1000)
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const input = `${b({ alg: 'RS256', typ: 'JWT', kid: opts.kid ?? kid })}.${b({ iss: 'bkesari-hub', iat, exp: opts.exp ?? iat + 60, ...claims })}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), opts.key ?? privateKey).toString('base64url')}`
}
const asha = { sub: 'hub-asha', email: 'Asha@Example.com', role: 'karta', aud: 'ladwani' }

describe('verifyHubToken', () => {
  it('accepts a token from the hub for LadWani', () => {
    expect(verifyHubToken(token(asha), jwks).sub).toBe('hub-asha')
  })
  it("refuses another project's token", () => {
    expect(() => verifyHubToken(token({ ...asha, aud: 'edu' }), jwks)).toThrow('another project')
  })
  it('refuses an expired token', () => {
    expect(() => verifyHubToken(token(asha, { exp: Math.floor(Date.now() / 1000) - 5 }), jwks)).toThrow('expired')
  })
  it('refuses a token signed by any other key', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    expect(() => verifyHubToken(token(asha, { key: other }), jwks)).toThrow(HubTokenError)
    expect(() => verifyHubToken('a.b.c', jwks)).toThrow(HubTokenError)
  })
})

describe('HubJwks', () => {
  it('uses an inline key set without fetching (LadWani inside the hub process)', async () => {
    const fetchImpl = jest.fn()
    const hub = new HubJwks(undefined, fetchImpl as never, JSON.stringify(jwks))
    expect(await hub.get()).toEqual(jwks)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('refuses an inline key set that is not JSON', async () => {
    await expect(new HubJwks(undefined, fetch, '{not json').get()).rejects.toThrow(HubTokenError)
  })
})

describe('AuthService.hubLogin', () => {
  let prisma: any
  let service: AuthService
  const roles: Record<string, { id: string; code: string }> = {
    MEMBER: { id: 'r-member', code: 'MEMBER' }, KARTA: { id: 'r-karta', code: 'KARTA' },
  }

  beforeEach(() => {
    prisma = {
      user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      member: { create: jest.fn() },
      role: { findUnique: jest.fn(({ where }) => roles[where.code] ?? null) },
      userRole: { findFirst: jest.fn(() => null), create: jest.fn() },
      refreshToken: { create: jest.fn() },
    }
    prisma.$transaction = jest.fn((fn) => fn(prisma))
    const hub = new HubJwks('http://hub/.well-known/jwks.json', (async () => ({ ok: true, json: async () => jwks })) as never)
    service = new AuthService(prisma, { sign: jest.fn(() => 'access') } as never, hub)
  })

  it('creates a linked account on first visit and grants the hub role', async () => {
    prisma.user.findFirst.mockResolvedValue(null)
    prisma.user.create.mockResolvedValue({ id: 'u1', hubUserId: 'hub-asha', status: 'ACTIVE' })
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', userRoles: [{ role: roles.MEMBER }, { role: roles.KARTA }], member: { id: 'm1' } })
    const r = await service.hubLogin(token(asha))
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ email: 'asha@example.com', hubUserId: 'hub-asha', status: 'ACTIVE' })
    expect(prisma.userRole.create).toHaveBeenCalledWith({ data: { userId: 'u1', roleId: 'r-karta' } })
    expect(r.user.roles).toEqual(['MEMBER', 'KARTA'])
  })

  it('links an existing account with the same email instead of duplicating it', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u0', hubUserId: null, status: 'ACTIVE' })
    prisma.user.update.mockResolvedValue({ id: 'u0', hubUserId: 'hub-asha' })
    prisma.user.findUnique.mockResolvedValue({ id: 'u0', userRoles: [], member: null })
    await service.hubLogin(token(asha))
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.user.update.mock.calls[0][0]).toMatchObject({ where: { id: 'u0' }, data: { hubUserId: 'hub-asha' } })
  })

  it('refuses an email already tied to a different bkesari ID', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u0', hubUserId: 'someone-else', status: 'ACTIVE' })
    await expect(service.hubLogin(token(asha))).rejects.toBeInstanceOf(ConflictException)
  })

  it('refuses a missing or forged token', async () => {
    await expect(service.hubLogin(undefined)).rejects.toBeInstanceOf(UnauthorizedException)
    await expect(service.hubLogin(token({ ...asha, aud: 'edu' }))).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
