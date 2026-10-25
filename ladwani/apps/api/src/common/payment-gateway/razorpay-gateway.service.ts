import { createHmac, timingSafeEqual } from 'crypto'
import { Injectable, InternalServerErrorException } from '@nestjs/common'
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

const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1'

/**
 * Real Razorpay integration per docs/19-payment-integration-design.md,
 * talking to Razorpay's documented REST API directly (Basic Auth over
 * HTTPS) rather than the `razorpay` npm package — this avoids depending on
 * an SDK version this codebase has no way to verify against a live account
 * yet. The signature-verification scheme (HMAC-SHA256 + timingSafeEqual,
 * never `===`) matches docs/19 §2 exactly.
 *
 * Requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET
 * to be set. Credentials are read lazily (on first real call) rather than
 * in the constructor: PaymentGatewayModule always instantiates this class
 * alongside DevGatewayService so its factory can choose between them, and
 * a constructor-time throw would crash the app at startup even when the
 * DEV gateway is the one actually selected. Misconfiguration is instead
 * surfaced the moment this gateway is actually used.
 */
@Injectable()
export class RazorpayGatewayService implements PaymentGateway {
  readonly code = 'RAZORPAY'

  private get keyId(): string {
    return this.requireEnv('RAZORPAY_KEY_ID')
  }

  private get keySecret(): string {
    return this.requireEnv('RAZORPAY_KEY_SECRET')
  }

  private get webhookSecret(): string {
    return this.requireEnv('RAZORPAY_WEBHOOK_SECRET')
  }

  private requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) throw new Error(`${name} must be set to use the Razorpay gateway.`)
    return value
  }

  async createOrder(input: CreateOrderInput): Promise<GatewayOrder> {
    const order = await this.request<{ id: string; amount: number; currency: string }>('POST', '/orders', {
      amount: Math.round(input.amount * 100), // Razorpay amounts are in paise
      currency: input.currency,
      receipt: input.receipt,
    })
    return { gatewayOrderId: order.id, amount: order.amount / 100, currency: order.currency }
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerificationResult> {
    const expected = this.hmac(`${input.gatewayOrderId}|${input.gatewayPaymentId}`, this.keySecret)
    if (!this.constantTimeEqual(expected, input.gatewaySignature)) return { verified: false }

    const payment = await this.request<{ amount: number; status: string }>('GET', `/payments/${input.gatewayPaymentId}`)
    return { verified: payment.status === 'captured' || payment.status === 'authorized', amount: payment.amount / 100, rawResponse: payment }
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const expected = this.hmac(rawBody, this.webhookSecret)
    return this.constantTimeEqual(expected, signature)
  }

  parseWebhookEvent(rawBody: Buffer): GatewayWebhookEvent {
    const payload = JSON.parse(rawBody.toString('utf8'))
    const paymentEntity = payload?.payload?.payment?.entity
    return {
      gatewayEventId: payload.id ?? `${payload.event}_${paymentEntity?.id ?? 'unknown'}`,
      eventType: payload.event,
      gatewayOrderId: paymentEntity?.order_id,
      gatewayPaymentId: paymentEntity?.id,
      payload,
    }
  }

  async initiateRefund(input: RefundInput): Promise<GatewayRefund> {
    const refund = await this.request<{ id: string; status: string }>(
      'POST',
      `/payments/${input.gatewayPaymentId}/refund`,
      { amount: Math.round(input.amount * 100) },
      input.idempotencyKey,
    )
    return { gatewayRefundId: refund.id, status: refund.status }
  }

  async getOrderStatus(gatewayOrderId: string): Promise<OrderStatus> {
    const order = await this.request<{ status: string; amount_paid: number }>('GET', `/orders/${gatewayOrderId}`)
    return { status: order.status, amountPaid: order.amount_paid / 100 }
  }

  private hmac(data: string | Buffer, secret: string): string {
    return createHmac('sha256', secret).update(data).digest('hex')
  }

  private constantTimeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return timingSafeEqual(bufA, bufB)
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')
    const res = await fetch(`${RAZORPAY_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'X-Razorpay-Idempotency': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '')
      throw new InternalServerErrorException(`Razorpay API error (${res.status}): ${errorBody}`)
    }
    return res.json() as Promise<T>
  }
}
