export interface CreateOrderInput {
  amount: number
  currency: string
  receipt: string
}

export interface GatewayOrder {
  gatewayOrderId: string
  amount: number
  currency: string
}

export interface VerifyPaymentInput {
  gatewayOrderId: string
  gatewayPaymentId: string
  gatewaySignature: string
}

export interface VerificationResult {
  verified: boolean
  amount?: number
  rawResponse?: unknown
}

export interface GatewayWebhookEvent {
  gatewayEventId: string
  eventType: string
  gatewayOrderId?: string
  gatewayPaymentId?: string
  payload: unknown
}

export interface RefundInput {
  gatewayPaymentId: string
  amount: number
  idempotencyKey: string
}

export interface GatewayRefund {
  gatewayRefundId: string
  status: string
}

export interface OrderStatus {
  status: string
  amountPaid: number
}

/**
 * docs/10-payment-architecture.md §1 — one implementation per provider, all
 * behind this interface. Booking/fee/donation modules only ever talk to
 * this token, never to a provider SDK directly, so switching providers is
 * a factory change, not a business-logic change.
 */
export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY'

export interface PaymentGateway {
  readonly code: string
  createOrder(input: CreateOrderInput): Promise<GatewayOrder>
  verifyPayment(input: VerifyPaymentInput): Promise<VerificationResult>
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean
  parseWebhookEvent(rawBody: Buffer): GatewayWebhookEvent
  initiateRefund(input: RefundInput): Promise<GatewayRefund>
  /** Not in docs/10's illustrative interface, but needed for docs/19 §4's reconciliation job — re-queries the gateway's own record of an order directly. */
  getOrderStatus(gatewayOrderId: string): Promise<OrderStatus>
}
