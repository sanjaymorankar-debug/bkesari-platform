import { Injectable } from '@nestjs/common'
import { createTransport, type SMTPTransportOptions, type Transporter } from 'nodemailer'
import type { MailSettings } from './mail-settings'

/** One plain-text email. */
export interface OutgoingMail {
  to: string
  subject: string
  text: string
}

/** What actually sends: SMTP in the running app, FakeMailTransport in tests. */
export interface MailTransport {
  send(settings: MailSettings, mail: OutgoingMail): Promise<void>
}

/** Nest token for the MailTransport; tests override it with a FakeMailTransport. */
export const MAIL_TRANSPORT = 'LADWANI_MAIL_TRANSPORT'

/** nodemailer's SMTP options for these settings: short timeouts, and no protocol log (it would carry the code). */
export function smtpOptions(settings: MailSettings): SMTPTransportOptions {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTLS,
    auth: settings.auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    logger: false,
    debug: false,
  }
}

/** Sends over SMTP with nodemailer, one connection per message. */
@Injectable()
export class SmtpMailTransport implements MailTransport {
  private current?: { key: string; transporter: Transporter }

  async send(settings: MailSettings, mail: OutgoingMail): Promise<void> {
    await this.transporter(settings).sendMail({ from: settings.from, to: mail.to, subject: mail.subject, text: mail.text })
  }

  /** The same transporter while the settings stay the same; a new one when they change. */
  private transporter(settings: MailSettings): Transporter {
    const key = JSON.stringify(settings)
    if (this.current?.key !== key) this.current = { key, transporter: createTransport(smtpOptions(settings)) }
    return this.current.transporter
  }
}
