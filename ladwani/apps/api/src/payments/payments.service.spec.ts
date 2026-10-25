import { Test } from '@nestjs/testing'
import { BadRequestException } from '@nestjs/common'
import { PaymentsService } from './payments.service'
import { PrismaService } from '../prisma/prisma.service'
import { PAYMENT_GATEWAY } from '../common/payment-gateway/payment-gateway.interface'

describe('PaymentsService', () => {
  let service: PaymentsService
  let prisma: {
    paymentTransaction: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; updateMany: jest.Mock }
    paymentGatewayTransaction: { create: jest.Mock; findFirst: jest.Mock }
    paymentWebhook: { create: jest.Mock; findUnique: jest.Mock }
    paymentReceipt: { upsert: jest.Mock }
    refund: { create: jest.Mock; update: jest.Mock }
    financialLedgerEntry: { create: jest.Mock }
    paymentReconciliation: { create: jest.Mock }
    $transaction: jest.Mock
  }
  let gateway: {
    code: string
    createOrder: jest.Mock
    verifyPayment: jest.Mock
    verifyWebhookSignature: jest.Mock
    parseWebhookEvent: jest.Mock
    initiateRefund: jest.Mock
    getOrderStatus: jest.Mock
  }

  beforeEach(async () => {
    prisma = {
      paymentTransaction: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      paymentGatewayTransaction: { create: jest.fn(), findFirst: jest.fn() },
      paymentWebhook: { create: jest.fn(), findUnique: jest.fn() },
      paymentReceipt: { upsert: jest.fn() },
      refund: { create: jest.fn(), update: jest.fn() },
      financialLedgerEntry: { create: jest.fn() },
      paymentReconciliation: { create: jest.fn() },
      $transaction: jest.fn(),
    }
    gateway = {
      code: 'DEV',
      createOrder: jest.fn(),
      verifyPayment: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      parseWebhookEvent: jest.fn(),
      initiateRefund: jest.fn(),
      getOrderStatus: jest.fn(),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [PaymentsService, { provide: PrismaService, useValue: prisma }, { provide: PAYMENT_GATEWAY, useValue: gateway }],
    }).compile()

    service = moduleRef.get(PaymentsService)
  })

  describe('duplicate webhook handling', () => {
    it('stores a new, signature-valid webhook event and reports it as new', async () => {
      gateway.verifyWebhookSignature.mockReturnValue(true)
      gateway.parseWebhookEvent.mockReturnValue({ gatewayEventId: 'evt_1', eventType: 'payment.captured', gatewayOrderId: 'order_1', gatewayPaymentId: 'pay_1', payload: {} })
      prisma.paymentWebhook.findUnique.mockResolvedValue(null)
      prisma.paymentGatewayTransaction.findFirst.mockResolvedValue({ paymentTransactionId: 'txn_1' })

      const result = await service.recordWebhook(Buffer.from('{}'), 'sig')

      expect(result).toEqual(expect.objectContaining({ accepted: true, isNew: true, transactionId: 'txn_1' }))
      expect(prisma.paymentWebhook.create).toHaveBeenCalledTimes(1)
    })

    it('recognizes a replayed event by (gatewayCode, gatewayEventId) and does not store it twice', async () => {
      gateway.verifyWebhookSignature.mockReturnValue(true)
      gateway.parseWebhookEvent.mockReturnValue({ gatewayEventId: 'evt_1', eventType: 'payment.captured', gatewayOrderId: 'order_1', gatewayPaymentId: 'pay_1', payload: {} })
      prisma.paymentWebhook.findUnique.mockResolvedValue({ id: 'existing-webhook-row' })

      const result = await service.recordWebhook(Buffer.from('{}'), 'sig')

      expect(result).toEqual(expect.objectContaining({ accepted: true, isNew: false }))
      expect(prisma.paymentWebhook.create).not.toHaveBeenCalled()
    })

    it('still stores an invalid-signature webhook for audit, but never as a valid/actionable event', async () => {
      gateway.verifyWebhookSignature.mockReturnValue(false)

      const result = await service.recordWebhook(Buffer.from('{"id":"evt_bad","event":"payment.captured"}'), 'wrong-sig')

      expect(result).toEqual(expect.objectContaining({ accepted: false, isNew: false }))
      expect(prisma.paymentWebhook.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ signatureValid: false }) }))
    })
  })

  describe('payment retry / idempotent verification', () => {
    it('does not re-verify with the gateway when the transaction is already SUCCESSFUL', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'txn_1',
        status: 'SUCCESSFUL',
        gatewayTransaction: { gatewayOrderId: 'order_1' },
      })

      const result = await service.verifyWithGateway('txn_1', 'pay_1', 'sig')

      expect(result.alreadyApplied).toBe(true)
      expect(gateway.verifyPayment).not.toHaveBeenCalled()
    })

    it('calls the gateway exactly once per retry attempt when still pending', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'txn_1',
        status: 'PENDING',
        gatewayTransaction: { gatewayOrderId: 'order_1' },
      })
      gateway.verifyPayment.mockResolvedValue({ verified: false })

      await service.verifyWithGateway('txn_1', 'pay_1', 'sig')
      await service.verifyWithGateway('txn_1', 'pay_1', 'sig')

      expect(gateway.verifyPayment).toHaveBeenCalledTimes(2)
    })
  })

  describe('refund math (partial/split refunds)', () => {
    function setupTransaction(amount: number, existingRefunds: { amount: number; status: string }[]) {
      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'txn_1',
        status: 'SUCCESSFUL',
        amount,
        gatewayTransaction: { gatewayPaymentId: 'pay_1' },
        refunds: existingRefunds,
      })
    }

    it('allows a partial refund within the remaining balance', async () => {
      setupTransaction(1000, [])
      prisma.refund.create.mockResolvedValue({ id: 'refund_1' })
      gateway.initiateRefund.mockResolvedValue({ gatewayRefundId: 'gw_refund_1', status: 'PROCESSING' })
      const tx = { refund: { update: jest.fn().mockResolvedValue({ id: 'refund_1', status: 'PROCESSING' }) }, financialLedgerEntry: { create: jest.fn() }, paymentTransaction: { update: jest.fn() } }
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await service.initiateRefund('admin-1', 'txn_1', 400)

      expect(tx.paymentTransaction.update).toHaveBeenCalledWith({ where: { id: 'txn_1' }, data: { status: 'PARTIALLY_REFUNDED' } })
    })

    it('flips to fully REFUNDED once cumulative refunds reach the original amount', async () => {
      setupTransaction(1000, [{ amount: 400, status: 'COMPLETED' }])
      prisma.refund.create.mockResolvedValue({ id: 'refund_2' })
      gateway.initiateRefund.mockResolvedValue({ gatewayRefundId: 'gw_refund_2', status: 'COMPLETED' })
      const tx = { refund: { update: jest.fn().mockResolvedValue({ id: 'refund_2', status: 'COMPLETED' }) }, financialLedgerEntry: { create: jest.fn() }, paymentTransaction: { update: jest.fn() } }
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await service.initiateRefund('admin-1', 'txn_1', 600)

      expect(tx.paymentTransaction.update).toHaveBeenCalledWith({ where: { id: 'txn_1' }, data: { status: 'REFUNDED' } })
    })

    it('refuses a refund whose sum with prior completed refunds would exceed the original payment', async () => {
      setupTransaction(1000, [{ amount: 700, status: 'COMPLETED' }])

      await expect(service.initiateRefund('admin-1', 'txn_1', 400)).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.refund.create).not.toHaveBeenCalled()
    })

    it('ignores non-completed prior refunds when computing the remaining refundable balance', async () => {
      setupTransaction(1000, [{ amount: 700, status: 'FAILED' }])
      prisma.refund.create.mockResolvedValue({ id: 'refund_3' })
      gateway.initiateRefund.mockResolvedValue({ gatewayRefundId: 'gw_refund_3', status: 'COMPLETED' })
      const tx = { refund: { update: jest.fn().mockResolvedValue({}) }, financialLedgerEntry: { create: jest.fn() }, paymentTransaction: { update: jest.fn() } }
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await expect(service.initiateRefund('admin-1', 'txn_1', 700)).resolves.toBeDefined()
    })
  })

  describe('reconciliation', () => {
    it('flags a transaction as a mismatch when the gateway shows it paid but we never applied it', async () => {
      prisma.paymentTransaction.findMany.mockResolvedValue([
        { id: 'txn_stuck', status: 'PROCESSING', amount: 500, gatewayTransaction: { gatewayOrderId: 'order_stuck' } },
      ])
      gateway.getOrderStatus.mockResolvedValue({ status: 'PAID', amountPaid: 500 })
      prisma.paymentReconciliation.create.mockResolvedValue({ id: 'recon_1', mismatches: [] })

      await service.reconcile('DEV')

      expect(prisma.paymentReconciliation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mismatches: expect.arrayContaining([expect.objectContaining({ transactionId: 'txn_stuck', resolution: 'FLAGGED_PAID_NOT_APPLIED' })]),
          }),
        }),
      )
    })

    it('records a clean run (empty mismatches) when nothing is stuck', async () => {
      prisma.paymentTransaction.findMany.mockResolvedValue([])
      prisma.paymentReconciliation.create.mockResolvedValue({ id: 'recon_2', mismatches: [] })

      await service.reconcile('DEV')

      expect(prisma.paymentReconciliation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mismatches: [] }) }))
    })
  })
})
