import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import {
  BUILTIN_PASSWORD_MESSAGE,
  RESERVED_EMAIL_MESSAGE,
  builtinEmail,
  builtinPasswordRefused,
  configuredBuiltinHash,
  hashBuiltinPassword,
  isBuiltinAccount,
  isReservedEmail,
  normalizeBuiltinUsername,
  parseBuiltinHash,
  refuseReservedEmail,
  verifyBuiltinPassword,
} from './builtin-admins'

/** The cheapest cost parseBuiltinHash accepts, so the tests stay fast. */
const FAST = { N: 2 ** 14, r: 8, p: 1 }
const b64u = (bytes: number, fill = 1) => Buffer.alloc(bytes, fill).toString('base64url')

describe('built-in administrators: names and the reserved domain', () => {
  it('knows the two usernames, however they are typed, and nothing else', () => {
    expect(normalizeBuiltinUsername('  SMorankar ')).toBe('smorankar')
    expect(normalizeBuiltinUsername('SONALIMORANKAR')).toBe('sonalimorankar')
    for (const not of ['smorankar@builtin.bkesari.com', 'smorankar2', 'admin', '', null, undefined, 42]) {
      expect(normalizeBuiltinUsername(not)).toBeNull()
    }
  })

  it('gives each its address on the reserved domain', () => {
    expect(builtinEmail('smorankar')).toBe('smorankar@builtin.bkesari.com')
    expect(builtinEmail('sonalimorankar')).toBe('sonalimorankar@builtin.bkesari.com')
  })

  it('treats every address on the domain as reserved, however it is typed', () => {
    for (const yes of ['smorankar@builtin.bkesari.com', ' SonaliMorankar@Builtin.Bkesari.COM ', 'anyone@builtin.bkesari.com']) {
      expect(isReservedEmail(yes)).toBe(true)
      expect(() => refuseReservedEmail(yes)).toThrow(new BadRequestException(RESERVED_EMAIL_MESSAGE))
    }
    for (const no of ['asha@example.com', 'x@bkesari.com', 'x@notbuiltin.bkesari.com', '', null, undefined]) {
      expect(isReservedEmail(no)).toBe(false)
      expect(() => refuseReservedEmail(no)).not.toThrow()
    }
    expect(RESERVED_EMAIL_MESSAGE).toBe('This email address is reserved.')
  })

  it('recognises a built-in row by its address', () => {
    expect(isBuiltinAccount({ email: 'smorankar@builtin.bkesari.com' })).toBe(true)
    expect(isBuiltinAccount({ email: 'asha@example.com' })).toBe(false)
    expect(isBuiltinAccount({ email: null })).toBe(false)
    expect(isBuiltinAccount(null)).toBe(false)
  })

  it('refuses a password change with 403', () => {
    const err = builtinPasswordRefused()
    expect(err).toBeInstanceOf(ForbiddenException)
    expect(err.message).toBe(BUILTIN_PASSWORD_MESSAGE)
  })
})

describe('built-in administrators: the scrypt hash', () => {
  it('checks a hash it can parse: the right password, and only that', async () => {
    const parsed = parseBuiltinHash(await hashBuiltinPassword('the-right-one', FAST))
    expect(parsed).toMatchObject({ N: 2 ** 14, r: 8, p: 1 })
    expect(await verifyBuiltinPassword('the-right-one', parsed!)).toBe(true)
    expect(await verifyBuiltinPassword('the-right-on', parsed!)).toBe(false)
    expect(await verifyBuiltinPassword('', parsed!)).toBe(false)
  })

  it('takes the hash with spaces around it, as an env file may leave them', async () => {
    expect(parseBuiltinHash(`  ${await hashBuiltinPassword('x', FAST)}\n`)).not.toBeNull()
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not scrypt', `bcrypt:16384:8:1:${b64u(16)}:${b64u(32)}`],
    ['too few parts', `scrypt:16384:8:1:${b64u(16)}`],
    ['too many parts', `scrypt:16384:8:1:${b64u(16)}:${b64u(32)}:x`],
    ['N not a power of two', `scrypt:20000:8:1:${b64u(16)}:${b64u(32)}`],
    ['N below 2^14', `scrypt:8192:8:1:${b64u(16)}:${b64u(32)}`],
    ['N above 2^20', `scrypt:2097152:8:1:${b64u(16)}:${b64u(32)}`],
    ['N not digits', `scrypt:0x4000:8:1:${b64u(16)}:${b64u(32)}`],
    ['r of 0', `scrypt:16384:0:1:${b64u(16)}:${b64u(32)}`],
    ['r above 32', `scrypt:16384:33:1:${b64u(16)}:${b64u(32)}`],
    ['p of 0', `scrypt:16384:8:0:${b64u(16)}:${b64u(32)}`],
    ['p above 16', `scrypt:16384:8:17:${b64u(16)}:${b64u(32)}`],
    ['a salt under 16 bytes', `scrypt:16384:8:1:${b64u(15)}:${b64u(32)}`],
    ['a key under 32 bytes', `scrypt:16384:8:1:${b64u(16)}:${b64u(31)}`],
  ])('is off for a value that is not a valid hash (%s)', (_what, value) => {
    expect(parseBuiltinHash(value)).toBeNull()
    expect(configuredBuiltinHash({ BUILTIN_ADMIN_PASSWORD_HASH: value })).toBeNull()
  })

  it('reads BUILTIN_ADMIN_PASSWORD_HASH itself, not a LADWANI_ copy of it', async () => {
    const value = await hashBuiltinPassword('x', FAST)
    expect(configuredBuiltinHash({ BUILTIN_ADMIN_PASSWORD_HASH: value })).not.toBeNull()
    expect(configuredBuiltinHash({ LADWANI_BUILTIN_ADMIN_PASSWORD_HASH: value })).toBeNull()
  })

  // The hub makes the hash (scripts/hash-builtin-admin-password.js); LadWani must read it the same way.
  // Run in a plain node child, so the hub's module is loaded as the hub loads it.
  const hubModule = resolve(__dirname, '../../../../../portal/builtin-admins.js')
  const hub = (script: string, ...args: string[]) =>
    execFileSync(process.execPath, ['-e', `const hub = require(process.argv[1]); (async () => { ${script} })().then((v) => process.stdout.write(String(v)))`, hubModule, ...args], { encoding: 'utf8' })
  ;(existsSync(hubModule) ? it : it.skip)("checks a hash made by the hub's portal/builtin-admins.js, and the hub checks ours", async () => {
    const fromHub = parseBuiltinHash(hub('return hub.hashPassword(process.argv[2], { N: 2 ** 14, r: 8, p: 1 })', 'shared-secret-1'))
    expect(fromHub).not.toBeNull()
    expect(await verifyBuiltinPassword('shared-secret-1', fromHub!)).toBe(true)
    expect(await verifyBuiltinPassword('shared-secret-2', fromHub!)).toBe(false)
    const ours = await hashBuiltinPassword('shared-secret-1', FAST)
    expect(hub('return hub.verifyPassword(process.argv[2], hub.parseHash(process.argv[3]))', 'shared-secret-1', ours)).toBe('true')
    expect(hub('return hub.verifyPassword(process.argv[2], hub.parseHash(process.argv[3]))', 'shared-secret-2', ours)).toBe('false')
  })
})
