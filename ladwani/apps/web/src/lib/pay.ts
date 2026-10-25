'use client'

import { api } from './api-client'

export interface PaymentTransaction {
  id: string
  status: string
  amount: string
  purposeType: string
  purposeId: string
}

/**
 * Dev-mode-only convenience: chains order-create → dev-simulate → verify into one call.
 * Only works while PAYMENT_GATEWAY_PROVIDER=DEV — the real Razorpay checkout flow (create
 * order, hand off to Razorpay's SDK, then verify) replaces this once real credentials are wired.
 */
export async function payViaDevGateway(purposeType: 'FEE' | 'DONATION', purposeId: string, amount: number): Promise<PaymentTransaction> {
  const order = await api.post<{ transactionId: string }>('/payments/orders', { purposeType, purposeId, amount })
  const sim = await api.post<{ gatewayPaymentId: string; gatewaySignature: string }>(`/payments/${order.transactionId}/dev-simulate`)
  return api.post<PaymentTransaction>(`/payments/${order.transactionId}/verify`, sim)
}
