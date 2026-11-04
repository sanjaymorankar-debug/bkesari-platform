import type { MailSettings } from './mail-settings'
import type { MailTransport, OutgoingMail } from './mail-transport'

export interface SentMail extends OutgoingMail {
  from: MailSettings['from']
}

/**
 * An in-memory MailTransport for tests: keeps every message in `outbox`
 * instead of sending it. Set `failWith` to make the next sends fail as a
 * provider would.
 */
export class FakeMailTransport implements MailTransport {
  readonly outbox: SentMail[] = []
  failWith: Error | null = null

  async send(settings: MailSettings, mail: OutgoingMail): Promise<void> {
    if (this.failWith) throw this.failWith
    this.outbox.push({ ...mail, from: settings.from })
  }

  /** Messages sent to `address`, oldest first. */
  to(address: string): SentMail[] {
    return this.outbox.filter((m) => m.to === address)
  }

  /** The 6-digit code in the newest message to `address`, if any. */
  lastCode(address: string): string | undefined {
    const sent = this.to(address)
    const mail = sent[sent.length - 1]
    return mail ? /\b(\d{6})\b/.exec(mail.text)?.[1] : undefined
  }
}
