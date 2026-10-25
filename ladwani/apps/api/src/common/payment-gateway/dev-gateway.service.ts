import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { Injectable } from '@nestjs/common'
import type {
  CreateOrderInput,
  GatewayOrder,
  GatewayRefund,
  GatewayWebhookEvent,
  OrderStatus,
  PaymentGateway,
  RefundInput,
  VerificationResult,
  VerifyPaymentInput,
} from './payment-gateway.interface'

/**
 * Dev-only stand-in for a real gateway (same honest pattern as OTP delivery
 * since M0, and the booking payment stub in M3) — never acceptable in
 * production. Uses the exact same HMAC-SHA256 + timingSafeEqual scheme
 * docs/19-payment-integration-design.md §2 specifies for the real
 * RazorpayGateway, so the verification code path this exercises is the
 * real one, not a shortcut — only the "did money actually move" part is
 * simulated.
 */
@Injectable()
export class DevGatewayService implements PaymentGateway {
  readonly code = 'DEV'

  private readonly keySecret = process.env.DEV_GATEWAY_SECRET ?? 'dev-gateway-secret-do-not-use-in-production'
  private readonly webhookSecret = process.env.DEV_GATEWAY_WEBHOOK_SECRET ?? 'dev-gateway-webhook-secret'
  private readonly orders = new Map<string, { amount: number; status: string }>()

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    const gatewayOrderId = `dev_order_${randomBytes(8).toString('hex')}`
    this.orders.set(gatewayOrderId, { amount: input.amount, status: 'CREATED' })
    return { gatewayOrderId, amount: input.amount, currency: input.currency }
  }

  /** Dev-only: simulates the checkout succeeding and returns exactly what a real gateway's client-side redirect would hand back. */
  simulatePaymentSuccess(gatewayOrderId: string): { gatewayPaymentId: string; gatewaySignature: string } {
    const order = this.orders.get(gatewayOrderId)
    if (order) order.status = 'PAID'
    const gatewayPaymentId = `dev_pay_${randomBytes(8).toString('hex')}`
    return { gatewayPaymentId, gatewaySignature: this.signPayment(gatewayOrderId, gatewayPaymentId) }
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerificationResult> {
    const expected = this.signPayment(input.gatewayOrderId, input.gatewayPaymentId)
    const verified = this.constantTimeEqual(expected, input.gatewaySignature)
    const order = this.orders.get(input.gatewayOrderId)
    return { verified, amount: order?.amount, rawResponse: { gatewayOrderId: input.gatewayOrderId, gatewayPaymentId: input.gatewayPaymentId } }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex')
    return this.constantTimeEqual(expected, signature)
  }

  parseWebhookEvent(rawBody: Buffer): GatewayWebhookEvent {
    const payload = JSON.parse(rawBody.toString('utf8'))
    return {
      gatewayEventId: payload.id,
      eventType: payload.event,
      gatewayOrderId: payload.orderId,
      gatewayPaymentId: payload.paymentId,
      payload,
    }
  }

  async initiateRefund(input: RefundInput): Promise<GatewayRefund> {
    return { gatewayRefundId: `dev_refund_${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 16)}`, status: 'COMPLETED' }
  }

  async getOrderStatus(gatewayOrderId: string): Promise<OrderStatus> {
    const order = this.orders.get(gatewayOrderId)
    if (!order) return { status: 'UNKNOWN', amountPaid: 0 }
    return { status: order.status, amountPaid: order.status === 'PAID' ? order.amount : 0 }
  }

  /** Dev-only: builds a webhook payload signed with this gateway's own webhook secret, for exercising the webhook endpoint without a real provider. */
  buildSignedWebhook(eventType: string, gatewayOrderId: string, gatewayPaymentId: string): { rawBody: Buffer; signature: string } {
    const body = JSON.stringify({ id: `dev_evt_${randomBytes(6).toString('hex')}`, event: eventType, orderId: gatewayOrderId, paymentId: gatewayPaymentId })
    const rawBody = Buffer.from(body, 'utf8')
    return { rawBody, signature: createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex') }
  }

  private signPayment(gatewayOrderId: string, gatewayPaymentId: string): string {
    return createHmac('sha256', this.keySecret).update(`${gatewayOrderId}|${gatewayPaymentId}`).digest('hex')
  }

  private constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  }
}
