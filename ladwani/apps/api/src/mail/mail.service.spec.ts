import { createServer, type AddressInfo, type Server, type Socket } from 'net'
import { Logger } from '@nestjs/common'
import { DEFAULT_FROM_NAME, mailSettings, maskEmail, scrubForLog } from './mail-settings'
import { MailDeliveryError, MailNotConfiguredError, MailService } from './mail.service'
import { SmtpMailTransport, smtpOptions } from './mail-transport'
import { FakeMailTransport } from './fake-mail-transport'

const KEYS = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USERNAME', 'MAIL_PASSWORD', 'MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME', 'MAIL_SCHEME']
const HOSTINGER = { MAIL_HOST: 'smtp.hostinger.com', MAIL_USERNAME: 'no-reply@bkesari.com', MAIL_PASSWORD: ' p@ss word ' }

describe('mailSettings', () => {
  it('is off without MAIL_HOST, or without a sender address', () => {
    expect(mailSettings({})).toBeNull()
    expect(mailSettings({ MAIL_HOST: '  ' })).toBeNull()
    expect(mailSettings({ MAIL_HOST: 'smtp.hostinger.com' })).toBeNull()
  })

  it('465 is TLS from the first byte; the sender defaults to the mailbox and to "LadWani · bkesari"', () => {
    expect(mailSettings({ ...HOSTINGER, MAIL_PORT: '465' })).toEqual({
      host: 'smtp.hostinger.com',
      port: 465,
      secure: true,
      requireTLS: false,
      // A password is taken as typed, spaces and all.
      auth: { user: 'no-reply@bkesari.com', pass: ' p@ss word ' },
      from: { name: DEFAULT_FROM_NAME, address: 'no-reply@bkesari.com' },
    })
    expect(DEFAULT_FROM_NAME).toBe('LadWani · bkesari')
    // 465 is the default port.
    expect(mailSettings(HOSTINGER)).toMatchObject({ port: 465, secure: true })
  })

  it('587 is STARTTLS, which is then required', () => {
    expect(mailSettings({ ...HOSTINGER, MAIL_PORT: '587' })).toMatchObject({ port: 587, secure: false, requireTLS: true })
    expect(mailSettings({ ...HOSTINGER, MAIL_PORT: '2465', MAIL_SCHEME: 'smtps' })).toMatchObject({ secure: true })
    expect(mailSettings({ ...HOSTINGER, MAIL_PORT: '465', MAIL_SCHEME: 'smtp' })).toMatchObject({ secure: false, requireTLS: true })
  })

  it('needs no TLS only for a mail catcher on this machine', () => {
    expect(mailSettings({ MAIL_HOST: '127.0.0.1', MAIL_PORT: '1025', MAIL_FROM_ADDRESS: 'dev@localhost' })).toMatchObject({
      secure: false,
      requireTLS: false,
      auth: undefined,
    })
  })

  it('takes MAIL_FROM_ADDRESS and MAIL_FROM_NAME when set', () => {
    expect(mailSettings({ ...HOSTINGER, MAIL_FROM_ADDRESS: 'ladwani@bkesari.com', MAIL_FROM_NAME: 'LadWani' })?.from).toEqual({
      name: 'LadWani',
      address: 'ladwani@bkesari.com',
    })
  })

  it('LADWANI_ settings win over the shared ones; a blank one does not', () => {
    const s = mailSettings({ ...HOSTINGER, MAIL_FROM_NAME: 'bkesari', LADWANI_MAIL_FROM_NAME: 'LadWani', LADWANI_MAIL_HOST: ' ', LADWANI_MAIL_PORT: '587' })
    expect(s).toMatchObject({ host: 'smtp.hostinger.com', port: 587, from: { name: 'LadWani' } })
  })

  it('is off for a port that is not one', () => {
    expect(mailSettings({ ...HOSTINGER, MAIL_PORT: 'smtp' })).toBeNull()
    expect(mailSettings({ ...HOSTINGER, MAIL_PORT: '70000' })).toBeNull()
  })

  it('becomes nodemailer options with short timeouts and no protocol log', () => {
    const options = smtpOptions(mailSettings({ ...HOSTINGER, MAIL_PORT: '587' })!)
    expect(options).toMatchObject({ host: 'smtp.hostinger.com', port: 587, secure: false, requireTLS: true, logger: false, debug: false })
    expect(options.connectionTimeout).toBeLessThanOrEqual(10_000)
  })
})

describe('masking for logs', () => {
  it('masks addresses and hides 6-digit runs', () => {
    expect(maskEmail('asha@example.com')).toBe('a***@example.com')
    expect(maskEmail('no-at-sign')).toBe('***')
    expect(scrubForLog('550 5.1.1 <asha@example.com>: Recipient address rejected; code 123456')).toBe(
      '550 5.1.1 <a***@example.com>: Recipient address rejected; code ******',
    )
  })
})

describe('MailService', () => {
  const saved = { ...process.env }
  let warn: jest.SpyInstance

  beforeEach(() => {
    process.env = { ...saved }
    for (const k of KEYS) {
      delete process.env[k]
      delete process.env[`LADWANI_${k}`]
    }
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    process.env = { ...saved }
    warn.mockRestore()
  })

  it('reads the settings on every call: configured once MAIL_HOST and a sender are set, no restart', async () => {
    const fake = new FakeMailTransport()
    const service = new MailService(fake)
    expect(service.configured()).toBe(false)
    await expect(service.send({ to: 'asha@example.com', subject: 's', text: 't' })).rejects.toBeInstanceOf(MailNotConfiguredError)
    Object.assign(process.env, HOSTINGER)
    expect(service.configured()).toBe(true)
    await service.send({ to: 'asha@example.com', subject: '123456 is your LadWani code', text: 'Your LadWani code is 123456' })
    expect(fake.outbox).toEqual([
      { to: 'asha@example.com', subject: '123456 is your LadWani code', text: 'Your LadWani code is 123456', from: { name: 'LadWani · bkesari', address: 'no-reply@bkesari.com' } },
    ])
  })

  it('logs a failure with the address masked, and never the code or the password', async () => {
    Object.assign(process.env, HOSTINGER)
    const fake = new FakeMailTransport()
    fake.failWith = Object.assign(new Error('Can\'t send mail - all recipients were rejected: 550 <asha@example.com> no such user'), { code: 'EENVELOPE' })
    const err = await new MailService(fake).send({ to: 'asha@example.com', subject: '654321 is your LadWani code', text: 'Your LadWani code is 654321' }).catch((e) => e)
    expect(err).toBeInstanceOf(MailDeliveryError)
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(line).toContain('a***@example.com')
    expect(line).toContain('EENVELOPE')
    expect(line).not.toContain('asha@example.com')
    expect(line).not.toContain('654321')
    expect(line).not.toContain('p@ss word')
    expect(err.message).not.toContain('654321')
  })
})

/**
 * Just enough of an SMTP server for one message, on loopback: no TLS (allowed
 * for 127.0.0.1 only), AUTH PLAIN or LOGIN accepted and recorded.
 */
function smtpCatcher(): Promise<{ server: Server; port: number; received: { auth: string[]; from: string; to: string[]; data: string }[]; close: () => Promise<void> }> {
  const received: { auth: string[]; from: string; to: string[]; data: string }[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const msg = { auth: [] as string[], from: '', to: [] as string[], data: '' }
    let mode: 'cmd' | 'data' | 'login-user' | 'login-pass' = 'cmd'
    let buffer = ''
    const say = (line: string) => socket.write(`${line}\r\n`)
    say('220 catcher ESMTP')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let at: number
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        if (mode === 'data') {
          if (line === '.') {
            mode = 'cmd'
            received.push(msg)
            say('250 queued')
          } else msg.data += `${line}\n`
          continue
        }
        if (mode === 'login-user') {
          msg.auth.push(Buffer.from(line, 'base64').toString('utf8'))
          mode = 'login-pass'
          say('334 UGFzc3dvcmQ6')
          continue
        }
        if (mode === 'login-pass') {
          msg.auth.push(Buffer.from(line, 'base64').toString('utf8'))
          mode = 'cmd'
          say('235 ok')
          continue
        }
        const verb = line.split(' ')[0].toUpperCase()
        if (verb === 'EHLO') socket.write('250-catcher\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n')
        else if (verb === 'AUTH' && /^AUTH PLAIN /i.test(line)) {
          msg.auth.push(...Buffer.from(line.slice(11), 'base64').toString('utf8').split('\0').filter(Boolean))
          say('235 ok')
        } else if (verb === 'AUTH') {
          mode = 'login-user'
          say('334 VXNlcm5hbWU6')
        } else if (verb === 'MAIL') {
          msg.from = line
          say('250 ok')
        } else if (verb === 'RCPT') {
          msg.to.push(line)
          say('250 ok')
        } else if (verb === 'DATA') {
          mode = 'data'
          say('354 go ahead')
        } else if (verb === 'STARTTLS') {
          say('502 5.5.1 STARTTLS not supported here')
        } else if (verb === 'QUIT') {
          say('221 bye')
          socket.end()
        } else say('250 ok')
      }
    })
  })
  // A client that gave up may leave its connection open; close() does not wait for it.
  const close = () =>
    new Promise<void>((resolve) => {
      sockets.forEach((s) => s.destroy())
      server.close(() => resolve())
    })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, received, close })))
}

describe('SmtpMailTransport (nodemailer, against a catcher on loopback)', () => {
  it('delivers the message: sender, recipient, subject and text, with the login it was given', async () => {
    const { port, received, close } = await smtpCatcher()
    try {
      const settings = mailSettings({
        MAIL_HOST: '127.0.0.1',
        MAIL_PORT: String(port),
        MAIL_USERNAME: 'no-reply@bkesari.com',
        MAIL_PASSWORD: 'catcher-only',
        MAIL_FROM_NAME: 'LadWani · bkesari',
      })!
      await new SmtpMailTransport().send(settings, { to: 'asha@example.com', subject: '123456 is your LadWani code', text: 'Your LadWani code is 123456\n' })
      expect(received).toHaveLength(1)
      const [msg] = received
      expect(msg.auth).toEqual(['no-reply@bkesari.com', 'catcher-only'])
      expect(msg.from).toMatch(/<no-reply@bkesari\.com>/)
      expect(msg.to).toEqual([expect.stringMatching(/<asha@example\.com>/)])
      expect(msg.data).toMatch(/^From: =\?UTF-8\?.+<no-reply@bkesari\.com>$/m)
      expect(msg.data).toMatch(/^To: asha@example\.com$/m)
      expect(msg.data).toMatch(/^Subject: 123456 is your LadWani code$/m)
      expect(msg.data).toContain('Your LadWani code is 123456')
    } finally {
      await close()
    }
  })

  it('with STARTTLS required (587 off this machine), a server without TLS never gets the login or the message', async () => {
    const { server, port, received, close } = await smtpCatcher()
    const seen: string[] = []
    server.on('connection', (socket) => socket.on('data', (c) => seen.push(c.toString('utf8'))))
    try {
      const settings = { ...mailSettings({ MAIL_HOST: '127.0.0.1', MAIL_PORT: String(port), MAIL_USERNAME: 'no-reply@bkesari.com', MAIL_PASSWORD: 'catcher-only' })!, requireTLS: true }
      await expect(new SmtpMailTransport().send(settings, { to: 'asha@example.com', subject: 's', text: 't' })).rejects.toThrow()
      expect(received).toHaveLength(0)
      expect(seen.join('')).not.toMatch(/AUTH/i)
    } finally {
      await close()
    }
  })
})
