import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { MailService } from '../mail/mail.service'
import { mayShowCodes } from '../common/tier'
import { codeEmail, type CodePurpose, type Lang } from './code-email'

export type CodeChannel = 'email' | 'sms'

/**
 * How a code goes out on this channel right now:
 *   send  a provider is configured: the code goes by email (or SMS), never on screen
 *   show  no provider, and this is the dev tier or a local run: the code is in the answer (devOtp)
 *   off   no provider on test or production: nothing is sent and the API answers 503
 */
export type DeliveryMode = 'send' | 'show' | 'off'

export const MAIL_UNAVAILABLE = 'We could not send the email right now. Try again later or sign in with your password.'
export const SMS_UNAVAILABLE = 'We could not send the text message right now. Try again later, or ask for a code by email.'

/**
 * Where LadWani's one-time codes go. Email by default (owner's decision, 4 Nov
 * 2026: SMS is on hold); the mobile paths stay in AuthService so SMS can come
 * back by making live('sms') true and sending in deliver().
 */
@Injectable()
export class CodeDeliveryService {
  constructor(private readonly mail: MailService) {}

  /** Whether a provider is configured for the channel. No SMS provider is wired in while SMS is on hold. */
  live(channel: CodeChannel): boolean {
    return channel === 'email' ? this.mail.configured() : false
  }

  mode(channel: CodeChannel): DeliveryMode {
    if (this.live(channel)) return 'send'
    return mayShowCodes() ? 'show' : 'off'
  }

  unavailable(channel: CodeChannel): ServiceUnavailableException {
    return new ServiceUnavailableException(channel === 'email' ? MAIL_UNAVAILABLE : SMS_UNAVAILABLE)
  }

  /** Answers 503 when the channel can neither send nor show: before any account is looked up, so every caller hears the same. */
  assertAvailable(channel: CodeChannel): void {
    if (this.mode(channel) === 'off') throw this.unavailable(channel)
  }

  /**
   * Sends `code` to `to`. Resolves to { devOtp } only in the 'show' mode;
   * otherwise to {} once the provider has taken the message, or throws the 503.
   */
  async deliver(channel: CodeChannel, to: string, code: string, purpose: CodePurpose, lang: Lang): Promise<{ devOtp?: string }> {
    const mode = this.mode(channel)
    if (mode === 'show') return { devOtp: code }
    // 'off', or SMS 'send', which cannot happen until an SMS provider is wired in.
    if (mode === 'off' || channel === 'sms') throw this.unavailable(channel)
    try {
      await this.mail.send({ to, ...codeEmail(code, purpose, lang) })
    } catch {
      // MailService has logged it, with the address masked.
      throw this.unavailable('email')
    }
    return {}
  }
}
