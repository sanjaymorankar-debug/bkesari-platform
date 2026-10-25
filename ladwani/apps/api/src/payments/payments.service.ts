import { randomBytes } from 'crypto'
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { PaymentTransaction } from '@prisma/client'
import type { PaymentPurposeType } from '@community-platform/shared-types'
import { PrismaService } from '../prisma/prisma.service'
import { PAYMENT_GATEWAY, type PaymentGateway } from '../common/payment-gateway/payment-gateway.interface'

type Tx = Prisma.TransactionClient

export interface CreateOrderInput {
  purposeType: PaymentPurposeType
  purposeId: string
  amount: number
  idempotencyKey?: string
}

/**
 * Generic payment-transaction engine — docs/10-payment-architecture.md.
 * Owns the CREATED→PENDING→...→SUCCESSFUL/FAILED state machine, the
 * gateway call, the ledger write, and webhook dedup/storage. Applying a
 * successful payment to the thing it paid for (a fee invoice, a donation)
 * is the owning module's job — see PaymentDispatchService, which mirrors
 * how ApprovalQueueService dispatches a resolved Approval — deliberately
 * not implemented here so this module never depends on fees/donations/
 * bookings.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_GATEWAY) private gateway: PaymentGateway,
  ) {}

  async createOrder(userId: string, input: CreateOrderInput) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.paymentTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { gatewayTransaction: true },
      })
      if (existing) return this.toOrderResponse(existing)
    }

    let transaction: PaymentTransaction
    try {
      transaction = await this.prisma.paymentTransaction.create({
        data: {
          userId,
          purposeType: input.purposeType,
          purposeId: input.purposeId,
          gatewayCode: this.gateway.code,
          amount: input.amount,
          status: 'CREATED',
          idempotencyKey: input.idempotencyKey,
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.idempotencyKey) {
        const existing = await this.prisma.paymentTransaction.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
          include: { gatewayTransaction: true },
        })
        return this.toOrderResponse(existing)
      }
      throw err
    }

    const receipt = `order-${transaction.id}`
    const order = await this.gateway.createOrder({ amount: input.amount, currency: 'INR', receipt })

    await this.prisma.paymentGatewayTransaction.create({ data: { paymentTransactionId: transaction.id, gatewayOrderId: order.gatewayOrderId } })
    await this.prisma.paymentTransaction.update({ where: { id: transaction.id }, data: { status: 'PENDING' } })

    return { transactionId: transaction.id, gatewayCode: this.gateway.code, gatewayOrderId: order.gatewayOrderId, amount: order.amount, currency: order.currency }
  }

  /** Calls the gateway (real I/O, outside any DB transaction) and returns the verdict without writing anything yet. */
  async verifyWithGateway(transactionId: string, gatewayPaymentId: string, gatewaySignature: string) {
    const transaction = await this.prisma.paymentTransaction.findUnique({ where: { id: transactionId }, include: { gatewayTransaction: true } })
    if (!transaction) throw new NotFoundException('Payment transaction not found.')
    if (!transaction.gatewayTransaction?.gatewayOrderId) throw new ConflictException('No gateway order is associated with this transaction.')

    if (transaction.status === 'SUCCESSFUL') return { transaction, verified: true, alreadyApplied: true, rawResponse: undefined as unknown }

    const result = await this.gateway.verifyPayment({
      gatewayOrderId: transaction.gatewayTransaction.gatewayOrderId,
      gatewayPaymentId,
      gatewaySignature,
    })
    return { transaction, verified: result.verified, alreadyApplied: false, rawResponse: result.rawResponse }
  }

  async markFailed(transactionId: string): Promise<void> {
    await this.prisma.paymentTransaction.updateMany({ where: { id: transactionId, status: { not: 'SUCCESSFUL' } }, data: { status: 'FAILED' } })
  }

  /** DB writes only — status, gateway record, ledger entry, receipt — inside the caller's transaction (docs/10 §3: never split across two). */
  async applySuccessfulPayment(
    tx: Tx,
    transactionId: string,
    gatewayPaymentId: string,
    gatewaySignature: string,
    rawResponse: unknown,
  ): Promise<PaymentTransaction> {
    const updated = await tx.paymentTransaction.update({ where: { id: transactionId }, data: { status: 'SUCCESSFUL' } })

    await tx.paymentGatewayTransaction.update({
      where: { paymentTransactionId: transactionId },
      data: { gatewayPaymentId, gatewaySignature, rawResponse: rawResponse as Prisma.InputJsonValue },
    })

    await tx.financialLedgerEntry.create({
      data: {
        entryType: updated.purposeType,
        paymentTransactionId: transactionId,
        amount: updated.amount,
        netAmount: updated.amount,
        createdBy: updated.userId,
      },
    })

    await tx.paymentReceipt.upsert({
      where: { paymentTransactionId: transactionId },
      update: {},
      create: { paymentTransactionId: transactionId, receiptNumber: this.generateReceiptNumber() },
    })

    return updated
  }

  /** Dedupe-and-store per docs/19 §3 — never runs business logic itself; the caller decides what an event means. */
  async recordWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
    if (!signatureHeader || !this.gateway.verifyWebhookSignature(rawBody, signatureHeader)) {
      const event = this.tryParse(rawBody)
      await this.prisma.paymentWebhook.create({
        data: {
          gatewayCode: this.gateway.code,
          gatewayEventId: event?.gatewayEventId ?? `invalid-${randomBytes(8).toString('hex')}`,
          eventType: event?.eventType ?? 'UNKNOWN',
          signatureValid: false,
          payload: (event?.payload ?? {}) as Prisma.InputJsonValue,
        },
      })
      return { accepted: false, event: null, isNew: false }
    }

    const event = this.gateway.parseWebhookEvent(rawBody)
    const existing = await this.prisma.paymentWebhook.findUnique({
      where: { gatewayCode_gatewayEventId: { gatewayCode: this.gateway.code, gatewayEventId: event.gatewayEventId } },
    })
    if (existing) return { accepted: true, event, isNew: false }

    let transactionId: string | undefined
    if (event.gatewayOrderId) {
      const gatewayTx = await this.prisma.paymentGatewayTransaction.findFirst({ where: { gatewayOrderId: event.gatewayOrderId } })
      transactionId = gatewayTx?.paymentTransactionId
    }

    await this.prisma.paymentWebhook.create({
      data: {
        paymentTransactionId: transactionId,
        gatewayCode: this.gateway.code,
        gatewayEventId: event.gatewayEventId,
        eventType: event.eventType,
        signatureValid: true,
        payload: event.payload as Prisma.InputJsonValue,
      },
    })

    return { accepted: true, event, isNew: true, transactionId }
  }

  async initiateRefund(actorUserId: string, transactionId: string, amount: number, reason?: string) {
    const transaction = await this.prisma.paymentTransaction.findUnique({ where: { id: transactionId }, include: { gatewayTransaction: true, refunds: true } })
    if (!transaction) throw new NotFoundException('Payment transaction not found.')
    if (transaction.status !== 'SUCCESSFUL' && transaction.status !== 'PARTIALLY_REFUNDED') {
      throw new ConflictException('Only a successful payment can be refunded.')
    }
    if (!transaction.gatewayTransaction?.gatewayPaymentId) throw new ConflictException('No gateway payment recorded for this transaction.')

    const alreadyRefunded = transaction.refunds.filter((r) => r.status === 'COMPLETED').reduce((sum, r) => sum + Number(r.amount), 0)
    if (alreadyRefunded + amount > Number(transaction.amount)) {
      throw new BadRequestException('Refund amount exceeds the remaining refundable balance.')
    }

    const refundRecord = await this.prisma.refund.create({
      data: { paymentTransactionId: transactionId, amount, reason, approvedBy: actorUserId, status: 'PENDING' },
    })

    const gatewayRefund = await this.gateway.initiateRefund({
      gatewayPaymentId: transaction.gatewayTransaction.gatewayPaymentId,
      amount,
      idempotencyKey: refundRecord.id,
    })

    return this.prisma.$transaction(async (tx) => {
      const updatedRefund = await tx.refund.update({
        where: { id: refundRecord.id },
        data: { status: gatewayRefund.status === 'COMPLETED' ? 'COMPLETED' : 'PROCESSING', gatewayRefundId: gatewayRefund.gatewayRefundId },
      })

      await tx.financialLedgerEntry.create({
        data: {
          entryType: 'REFUND',
          refundId: refundRecord.id,
          paymentTransactionId: transactionId,
          amount: -amount,
          netAmount: -amount,
          createdBy: actorUserId,
        },
      })

      const newTotal = alreadyRefunded + amount
      await tx.paymentTransaction.update({
        where: { id: transactionId },
        data: { status: newTotal >= Number(transaction.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      })

      return updatedRefund
    })
  }

  async reconcile(gatewayCode: string, staleMinutes = 10) {
    const staleCutoff = new Date(Date.now() - staleMinutes * 60_000)
    const stuck = await this.prisma.paymentTransaction.findMany({
      where: { gatewayCode, status: { in: ['PENDING', 'INITIATED', 'PROCESSING', 'UNDER_VERIFICATION'] }, updatedAt: { lt: staleCutoff } },
      include: { gatewayTransaction: true },
    })

    const mismatches: Array<{ transactionId: string; ourStatus: string; gatewayStatus: string; resolution: string }> = []

    for (const transaction of stuck) {
      if (!transaction.gatewayTransaction?.gatewayOrderId) continue
      const orderStatus = await this.gateway.getOrderStatus(transaction.gatewayTransaction.gatewayOrderId)

      if (orderStatus.status === 'PAID' && orderStatus.amountPaid >= Number(transaction.amount)) {
        mismatches.push({ transactionId: transaction.id, ourStatus: transaction.status, gatewayStatus: orderStatus.status, resolution: 'FLAGGED_PAID_NOT_APPLIED' })
      } else if (orderStatus.status === 'UNKNOWN') {
        mismatches.push({ transactionId: transaction.id, ourStatus: transaction.status, gatewayStatus: orderStatus.status, resolution: 'FLAGGED_FOR_ADMIN' })
      }
    }

    return this.prisma.paymentReconciliation.create({ data: { gatewayCode, mismatches: mismatches as unknown as Prisma.InputJsonValue } })
  }

  private toOrderResponse(transaction: PaymentTransaction & { gatewayTransaction: { gatewayOrderId: string | null } | null }) {
    return {
      transactionId: transaction.id,
      gatewayCode: transaction.gatewayCode,
      gatewayOrderId: transaction.gatewayTransaction?.gatewayOrderId ?? null,
      amount: Number(transaction.amount),
      currency: transaction.currency,
    }
  }

  private generateReceiptNumber(): string {
    return `RCPT-${new Date().getFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`
  }

  private tryParse(rawBody: Buffer): { gatewayEventId?: string; eventType?: string; payload?: unknown } | null {
    try {
      const payload = JSON.parse(rawBody.toString('utf8'))
      return { gatewayEventId: payload?.id, eventType: payload?.event, payload }
    } catch {
      return null
    }
  }
}
