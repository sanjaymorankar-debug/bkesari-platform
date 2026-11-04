import { Inject, Injectable, Logger } from '@nestjs/common'
import { mailSettings, maskEmail, scrubForLog } from './mail-settings'
import { MAIL_TRANSPORT, type MailTransport, type OutgoingMail } from './mail-transport'

/** Thrown by MailService.send when MAIL_HOST (or a sender address) is not set. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super('No mail provider is configured (MAIL_HOST).')
  }
}

/** Thrown by MailService.send when the provider did not take the message. */
export class MailDeliveryError extends Error {
  constructor(readonly reason: string) {
    super('The email could not be sent.')
  }
}

/**
 * LadWani's outgoing email (settings in mail-settings.ts). It logs a failure
 * with the address masked and the provider's reason, never the message
 * (subject and text carry the code) and never the password.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail')

  constructor(@Inject(MAIL_TRANSPORT) private readonly transport: MailTransport) {}

  /** Whether a mail provider is configured; checked on every call, so no restart is needed. */
  configured(): boolean {
    return mailSettings() !== null
  }

  async send(mail: OutgoingMail): Promise<void> {
    const settings = mailSettings()
    if (!settings) throw new MailNotConfiguredError()
    try {
      await this.transport.send(settings, mail)
    } catch (err) {
      const reason = scrubForLog(describe(err))
      this.log.warn(`Could not send an email to ${maskEmail(mail.to)} through ${settings.host}:${settings.port}: ${reason}`)
      throw new MailDeliveryError(reason)
    }
  }
}

/** nodemailer's error code and message (e.g. "EAUTH: Invalid login: 535 ..."), without its stack. */
function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' && code ? `${code}: ${err.message}` : err.message
}
