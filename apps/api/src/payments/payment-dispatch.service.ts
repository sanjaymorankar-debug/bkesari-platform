import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import type { PaymentTransaction, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { PaymentsService, CreateOrderInput } from './payments.service'
import { FeesService } from '../fees/fees.service'
import { DonationsService } from '../fees/donations.service'

type Tx = Prisma.TransactionClient

const SUCCESS_EVENT_TYPES = new Set(['payment.captured', 'payment.authorized'])

/**
 * Maps a verified payment's purposeType to the module that applies it —
 * the same generic-engine/dispatcher split as ApprovalsService and
 * ApprovalQueueService. Booking payments deliberately are not wired here:
 * M3 already ships a working (dev-stub) booking payment flow, and wiring
 * it through this newer, real-gateway path is left for when Razorpay
 * credentials make the swap meaningful, to avoid two competing paths for
 * the same booking.
 */
@Injectable()
export class PaymentDispatchService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private fees: FeesService,
    private donations: DonationsService,
  ) {}

  async createOrder(userId: string, input: CreateOrderInput) {
    if (input.purposeType === 'BOOKING') {
      throw new BadRequestException('Booking payments use POST /bookings/:id/confirm-payment, not this endpoint, until M4+ wires them through the real gateway.')
    }
    if (input.purposeType === 'FEE') {
      await this.fees.assertKartaOfInvoiceFamily(userId, input.purposeId)
      const outstanding = await this.fees.getOutstandingAmount(input.purposeId)
      if (Math.abs(outstanding - input.amount) > 0.01) {
        throw new BadRequestException(`Amount does not match the invoice's outstanding balance of ₹${outstanding}.`)
      }
    }
    if (input.purposeType === 'DONATION') {
      const donation = await this.prisma.donation.findUnique({ where: { id: input.purposeId } })
      if (!donation || donation.donorUserId !== userId) throw new ForbiddenException('This is not your donation.')
      if (donation.paymentTransactionId) throw new BadRequestException('This donation has already been paid.')
    }

    return this.payments.createOrder(userId, input)
  }

  async verifyAndApply(userId: string, transactionId: string, gatewayPaymentId: string, gatewaySignature: string): Promise<PaymentTransaction> {
    const { transaction, verified, alreadyApplied, rawResponse } = await this.payments.verifyWithGateway(transactionId, gatewayPaymentId, gatewaySignature)
    if (transaction.userId !== userId) throw new ForbiddenException('This is not your payment.')
    if (alreadyApplied) return transaction
    if (!verified) {
      await this.payments.markFailed(transactionId)
      throw new BadRequestException('Payment verification failed.')
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.payments.applySuccessfulPayment(tx, transactionId, gatewayPaymentId, gatewaySignature, rawResponse)
      await this.applyPurposeEffect(tx, updated)
      return updated
    })
  }

  async handleWebhook(rawBody: Buffer, signatureHeader: string | undefined): Promise<void> {
    const result = await this.payments.recordWebhook(rawBody, signatureHeader)
    if (!result.accepted || !result.isNew || !result.event || !result.transactionId) return
    if (!SUCCESS_EVENT_TYPES.has(result.event.eventType)) return
    if (!result.event.gatewayPaymentId) return

    const transaction = await this.prisma.paymentTransaction.findUnique({ where: { id: result.transactionId } })
    if (!transaction || transaction.status === 'SUCCESSFUL') return

    // The webhook itself is already signature-verified at this point (recordWebhook only reaches
    // here for signature-valid events) — no need to re-verify with the gateway a second time.
    await this.prisma.$transaction(async (tx) => {
      const updated = await this.payments.applySuccessfulPayment(tx, result.transactionId as string, result.event!.gatewayPaymentId as string, signatureHeader ?? '', result.event!.payload)
      await this.applyPurposeEffect(tx, updated)
    })
  }

  private async applyPurposeEffect(tx: Tx, transaction: PaymentTransaction): Promise<void> {
    switch (transaction.purposeType) {
      case 'FEE':
        return this.fees.applyPayment(tx, transaction.purposeId, Number(transaction.amount), transaction.id)
      case 'DONATION':
        return this.donations.markPaid(tx, transaction.purposeId, transaction.id)
      default:
        return
    }
  }
}
