import { createHmac } from 'crypto'
import {
  HUB_HEADER,
  encodeHubName,
  hubSecret,
  signHubIdentity,
  splitHubName,
  verifyHubIdentity,
} from './hub-identity'
import { builtinUsernameOf } from './builtin-admins'

const SECRET = 'test-hub-proxy-secret-0123456789'
const NOW = Date.UTC(2026, 10, 17, 18, 0, 0) // 17 Nov 2026, 11:30 PM IST
const NOW_S = Math.floor(NOW / 1000)

interface Fields {
  user: string
  email: string
  role: string
  name: string
  project: string
  ts: string
}

/** The contract's signature, written out here rather than taken from the code under test (bkesari-id.md §3). */
function contractSig(f: Fields, secret = SECRET): string {
  const input = `bkesari-id-v1\n${f.project}\n${f.user}\n${f.email}\n${f.role}\n${f.name}\n${f.ts}`
  return createHmac('sha256', secret).update(input, 'utf8').digest('base64url')
}

/** Headers as the hub sends them; `over` changes a field AFTER signing (a forgery), `signed` before. */
function headers(signed: Partial<Fields> = {}, over: Partial<Record<keyof Fields | 'sig', string | string[] | undefined>> = {}, secret = SECRET) {
  const f: Fields = {
    user: '101',
    email: 'asha@example.com',
    role: 'member',
    name: encodeHubName('आशा लाडवाणी'),
    project: 'ladwani',
    ts: String(NOW_S),
    ...signed,
  }
  const h: Record<string, string | string[] | undefined> = {
    [HUB_HEADER.user]: f.user,
    [HUB_HEADER.email]: f.email,
    [HUB_HEADER.role]: f.role,
    [HUB_HEADER.name]: f.name,
    [HUB_HEADER.project]: f.project,
    [HUB_HEADER.ts]: f.ts,
    [HUB_HEADER.sig]: contractSig(f, secret),
  }
  for (const [k, v] of Object.entries(over)) h[HUB_HEADER[k as keyof typeof HUB_HEADER]] = v
  return h
}

const verify = (h: Record<string, string | string[] | undefined>, opts: { secret?: string | null; now?: number } = {}) =>
  verifyHubIdentity(h, { secret: SECRET, now: NOW, ...opts })

describe('verifyHubIdentity', () => {
  it('believes a set signed as the contract says, and decodes the name from base64url UTF-8', () => {
    expect(verify(headers())).toEqual({ user: '101', email: 'asha@example.com', role: 'member', name: 'आशा लाडवाणी', ts: NOW_S })
  })

  it('signs exactly the contract string (signHubIdentity is what the hub must send)', () => {
    const f = { project: 'ladwani', user: '7', email: 'a@b.in', role: 'karta', name: encodeHubName('A B'), ts: '1700000000' }
    expect(signHubIdentity(f, SECRET)).toBe(contractSig(f))
  })

  it.each(['member', 'karta', 'operator', 'admin'])('accepts the role %s', (role) => {
    expect(verify(headers({ role }))?.role).toBe(role)
  })

  it('accepts an empty name, sent empty or left out', () => {
    expect(verify(headers({ name: '' }))?.name).toBe('')
    expect(verify(headers({ name: '' }, { name: undefined }))?.name).toBe('')
  })

  describe('ignores the headers entirely (null)', () => {
    it('when HUB_PROXY_SECRET is unset or blank here', () => {
      expect(verify(headers(), { secret: null })).toBeNull()
      expect(verify(headers(), { secret: '' })).toBeNull()
      expect(verify(headers(), { secret: '   ' })).toBeNull()
    })

    it('when signed with another key', () => {
      expect(verify(headers({}, {}, 'some-other-secret'))).toBeNull()
    })

    it('when any signed field was changed after signing', () => {
      expect(verify(headers({}, { user: '102' }))).toBeNull()
      expect(verify(headers({}, { email: 'eve@example.com' }))).toBeNull()
      expect(verify(headers({}, { role: 'admin' }))).toBeNull()
      expect(verify(headers({}, { name: encodeHubName('Eve') }))).toBeNull()
      expect(verify(headers({}, { ts: String(NOW_S - 1) }))).toBeNull()
      expect(verify(headers({}, { sig: contractSig({ user: '101', email: 'asha@example.com', role: 'member', name: '', project: 'ladwani', ts: String(NOW_S) }) }))).toBeNull()
    })

    it("when it is another project's identity, even correctly signed", () => {
      expect(verify(headers({ project: 'edu' }))).toBeNull()
      expect(verify(headers({ project: 'tasklist' }))).toBeNull()
      expect(verify(headers({ project: 'LadWani' }))).toBeNull()
    })

    it('when the time stamp is 60 seconds or more away from now, either way', () => {
      expect(verify(headers({ ts: String(NOW_S - 59) }))).not.toBeNull()
      expect(verify(headers({ ts: String(NOW_S + 59) }))).not.toBeNull()
      expect(verify(headers({ ts: String(NOW_S - 60) }))).toBeNull()
      expect(verify(headers({ ts: String(NOW_S + 60) }))).toBeNull()
      expect(verify(headers({ ts: String(NOW_S - 3600) }))).toBeNull()
    })

    it.each(['user', 'email', 'role', 'project', 'ts', 'sig'] as const)('when X-Bkesari-%s is missing', (field) => {
      expect(verify(headers({}, { [field]: undefined }))).toBeNull()
    })

    it('when a header came twice (Node lists or joins repeats)', () => {
      expect(verify(headers({}, { user: ['101', '102'] }))).toBeNull()
      expect(verify(headers({}, { email: ['asha@example.com'] }))).toBeNull()
    })

    it('when a field is malformed, even correctly signed', () => {
      expect(verify(headers({ user: 'abc' }))).toBeNull()
      expect(verify(headers({ user: '' }))).toBeNull()
      expect(verify(headers({ email: 'Asha@Example.com' }))).toBeNull()
      expect(verify(headers({ email: 'not-an-email' }))).toBeNull()
      expect(verify(headers({ email: ' asha@example.com' }))).toBeNull()
      expect(verify(headers({ role: 'owner' }))).toBeNull()
      expect(verify(headers({ role: '' }))).toBeNull()
      expect(verify(headers({ name: 'not base64url!' }))).toBeNull()
      expect(verify(headers({ name: Buffer.from([0xff, 0xfe]).toString('base64url') }))).toBeNull() // not UTF-8
      expect(verify(headers({ ts: '17e8' }))).toBeNull()
      expect(verify(headers({ ts: '' }))).toBeNull()
    })

    it('when the signature is not unpadded base64url of 32 bytes', () => {
      const good = headers()[HUB_HEADER.sig] as string
      expect(verify(headers({}, { sig: `${good}=` }))).toBeNull()
      expect(verify(headers({}, { sig: good.slice(0, -1) }))).toBeNull()
      expect(verify(headers({}, { sig: Buffer.from(good, 'base64url').toString('base64') }))).toBeNull()
      expect(verify(headers({}, { sig: '' }))).toBeNull()
    })
  })
})

describe('hubSecret', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('reads HUB_PROXY_SECRET (LADWANI_HUB_PROXY_SECRET wins), and blank is unset', () => {
    delete process.env.LADWANI_HUB_PROXY_SECRET
    delete process.env.HUB_PROXY_SECRET
    expect(hubSecret()).toBeNull()
    process.env.HUB_PROXY_SECRET = '  '
    expect(hubSecret()).toBeNull()
    process.env.HUB_PROXY_SECRET = 'hub-secret'
    expect(hubSecret()).toBe('hub-secret')
    process.env.LADWANI_HUB_PROXY_SECRET = 'ladwani-only'
    expect(hubSecret()).toBe('ladwani-only')
  })

  it('is what verifyHubIdentity uses when no secret is passed', () => {
    delete process.env.LADWANI_HUB_PROXY_SECRET
    delete process.env.HUB_PROXY_SECRET
    const h = headers({ ts: String(Math.floor(Date.now() / 1000)) })
    expect(verifyHubIdentity(h)).toBeNull()
    process.env.HUB_PROXY_SECRET = SECRET
    expect(verifyHubIdentity(h)?.user).toBe('101')
  })
})

describe('splitHubName', () => {
  it('splits at the first space', () => {
    expect(splitHubName('Asha Devi Ladwani', 'a@x.in')).toEqual({ firstName: 'Asha', lastName: 'Devi Ladwani' })
    expect(splitHubName('  आशा   लाडवाणी ', 'a@x.in')).toEqual({ firstName: 'आशा', lastName: 'लाडवाणी' })
  })

  it('keeps a single word as the first name', () => {
    expect(splitHubName('Asha', 'a@x.in')).toEqual({ firstName: 'Asha', lastName: null })
  })

  it("falls back to the email's local part", () => {
    expect(splitHubName('', 'asha.l@example.com')).toEqual({ firstName: 'asha.l', lastName: null })
    expect(splitHubName(' \n\t', 'asha.l@example.com')).toEqual({ firstName: 'asha.l', lastName: null })
  })

  it('drops control characters and keeps each part to 100 characters', () => {
    expect(splitHubName('Asha\u0000Bai', 'a@x.in')).toEqual({ firstName: 'Asha', lastName: 'Bai' })
    const long = splitHubName(`${'a'.repeat(150)} ${'b'.repeat(150)}`, 'a@x.in')
    expect(long.firstName).toHaveLength(100)
    expect(long.lastName).toHaveLength(100)
  })
})

describe('builtinUsernameOf', () => {
  it("names the built-in administrator whose LadWani address it is, and nothing else", () => {
    expect(builtinUsernameOf('smorankar@builtin.bkesari.com')).toBe('smorankar')
    expect(builtinUsernameOf('SonaliMorankar@Builtin.Bkesari.com')).toBe('sonalimorankar')
    expect(builtinUsernameOf('someone@builtin.bkesari.com')).toBeNull()
    expect(builtinUsernameOf('smorankar@example.com')).toBeNull()
    expect(builtinUsernameOf('smorankar')).toBeNull()
    expect(builtinUsernameOf(undefined)).toBeNull()
  })
})
