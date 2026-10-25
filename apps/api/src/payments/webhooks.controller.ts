import { BadRequestException, Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import type { RawBodyRequest } from '@nestjs/common'
import type { Request } from 'express'
import { PaymentDispatchService } from './payment-dispatch.service'

/**
 * No JwtAuthGuard here — this is called by the payment gateway itself, not
 * a logged-in user. Authenticity comes entirely from the signature check
 * inside PaymentsService.recordWebhook, computed over the raw request body
 * (docs/19 §3) — never trust this endpoint's caller by identity, only by
 * a valid signature.
 */
@Controller('webhooks/payments')
export class WebhooksController {
  constructor(private dispatch: PaymentDispatchService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-webhook-signature') signature?: string) {
    if (!req.rawBody) throw new BadRequestException('Missing request body.')
    await this.dispatch.handleWebhook(req.rawBody, signature)
    // Always 200 once durably stored and signature-checked, per docs/19 §3 — a non-200 just
    // makes the gateway retry unnecessarily; we already have the event on file either way.
    return { received: true }
  }
}
