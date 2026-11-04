import { Module } from '@nestjs/common'
import { MailService } from './mail.service'
import { MAIL_TRANSPORT, SmtpMailTransport } from './mail-transport'

/**
 * Outgoing email over SMTP (mail-settings.ts). Tests replace the transport:
 * `.overrideProvider(MAIL_TRANSPORT).useValue(new FakeMailTransport())`.
 */
@Module({
  providers: [MailService, { provide: MAIL_TRANSPORT, useClass: SmtpMailTransport }],
  exports: [MailService],
})
export class MailModule {}
