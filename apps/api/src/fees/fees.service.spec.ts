import { Test } from '@nestjs/testing'
import { FeesService } from './fees.service'
import { PrismaService } from '../prisma/prisma.service'
import { ApprovalsService } from '../common/approvals/approvals.service'
import { NotificationsService } from '../notifications/notifications.service'
import { FamilyAuthorizationService } from '../common/family-authorization/family-authorization.service'

describe('FeesService', () => {
  let service: FeesService
  let prisma: {
    feeInvoice: { findUnique: jest.Mock; findUniqueOrThrow: jest.Mock; update: jest.Mock }
    offlinePayment: { findUniqueOrThrow: jest.Mock; update: jest.Mock }
    financialLedgerEntry: { create: jest.Mock; updateMany: jest.Mock }
  }

  beforeEach(async () => {
    prisma = {
      feeInvoice: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), update: jest.fn() },
      offlinePayment: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      financialLedgerEntry: { create: jest.fn(), updateMany: jest.fn() },
    }
    const moduleRef = await Test.createTestingModule({
      providers: [
        FeesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalsService, useValue: { submit: jest.fn() } },
        { provide: NotificationsService, useValue: { notify: jest.fn() } },
        { provide: FamilyAuthorizationService, useValue: { assertIsKarta: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(FeesService)
  })

  describe('late fee computation (read-time, not cron-accrued)', () => {
    it('charges no late fee while still within the grace period', async () => {
      const invoice = {
        amountBilled: 1000,
        amountPaid: 0,
        status: 'UNPAID',
        dueDate: new Date(Date.now() - 2 * 86_400_000), // 2 days overdue
        feeRule: { lateFeeAmount: 100, gracePeriodDays: 5 },
        waivers: [],
      }
      prisma.feeInvoice.findUnique.mockResolvedValue(invoice)

      const result = await service.getInvoice('inv-1')

      expect(result.lateFee).toBe(0)
      expect(result.outstanding).toBe(1000)
    })

    it('adds the late fee once the grace period has passed', async () => {
      const invoice = {
        amountBilled: 1000,
        amountPaid: 0,
        status: 'UNPAID',
        dueDate: new Date(Date.now() - 10 * 86_400_000), // 10 days overdue
        feeRule: { lateFeeAmount: 100, gracePeriodDays: 5 },
        waivers: [],
      }
      prisma.feeInvoice.findUnique.mockResolvedValue(invoice)

      const result = await service.getInvoice('inv-1')

      expect(result.lateFee).toBe(100)
      expect(result.outstanding).toBe(1100)
    })

    it('never charges a late fee on a settled invoice', async () => {
      const invoice = {
        amountBilled: 1000,
        amountPaid: 1000,
        status: 'PAID',
        dueDate: new Date(Date.now() - 30 * 86_400_000),
        feeRule: { lateFeeAmount: 100, gracePeriodDays: 5 },
        waivers: [],
      }
      prisma.feeInvoice.findUnique.mockResolvedValue(invoice)

      const result = await service.getInvoice('inv-1')

      expect(result.lateFee).toBe(0)
      expect(result.outstanding).toBe(0)
    })

    it('subtracts waivers from the outstanding balance', async () => {
      const invoice = {
        amountBilled: 1000,
        amountPaid: 0,
        status: 'UNPAID',
        dueDate: new Date(Date.now() + 86_400_000),
        feeRule: { lateFeeAmount: 100, gracePeriodDays: 5 },
        waivers: [{ reductionAmount: 300 }],
      }
      prisma.feeInvoice.findUnique.mockResolvedValue(invoice)

      const result = await service.getInvoice('inv-1')

      expect(result.outstanding).toBe(700)
    })
  })

  describe('offline payment verification (approval-gated, never the payer)', () => {
    it('marks the invoice PAID and links the ledger entry when fully covered and approved', async () => {
      const tx = {
        offlinePayment: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'op-1', feeInvoiceId: 'inv-1', amount: 1000 }), update: jest.fn() },
        feeInvoice: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'inv-1', amountBilled: 1000, amountPaid: 0 }), update: jest.fn() },
        financialLedgerEntry: { create: jest.fn() },
      }
      const approval = { entityId: 'op-1', status: 'APPROVED', reviewedBy: 'operator-1' } as never

      await service.applyOfflinePaymentApproval(tx as never, approval)

      expect(tx.offlinePayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'VERIFIED' }) }))
      expect(tx.feeInvoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { amountPaid: 1000, status: 'PAID' } })
      expect(tx.financialLedgerEntry.create).toHaveBeenCalled()
    })

    it('marks a partially-covering offline payment PARTIAL, not PAID', async () => {
      const tx = {
        offlinePayment: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'op-2', feeInvoiceId: 'inv-2', amount: 400 }), update: jest.fn() },
        feeInvoice: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'inv-2', amountBilled: 1000, amountPaid: 0 }), update: jest.fn() },
        financialLedgerEntry: { create: jest.fn() },
      }
      const approval = { entityId: 'op-2', status: 'APPROVED', reviewedBy: 'operator-1' } as never

      await service.applyOfflinePaymentApproval(tx as never, approval)

      expect(tx.feeInvoice.update).toHaveBeenCalledWith({ where: { id: 'inv-2' }, data: { amountPaid: 400, status: 'PARTIAL' } })
    })

    it('rejects the offline payment and never touches the invoice when the Operator declines it', async () => {
      const tx = {
        offlinePayment: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'op-3', feeInvoiceId: 'inv-3', amount: 1000 }), update: jest.fn() },
        feeInvoice: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
        financialLedgerEntry: { create: jest.fn() },
      }
      const approval = { entityId: 'op-3', status: 'REJECTED', reviewedBy: 'operator-1' } as never

      await service.applyOfflinePaymentApproval(tx as never, approval)

      expect(tx.offlinePayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }))
      expect(tx.feeInvoice.update).not.toHaveBeenCalled()
      expect(tx.financialLedgerEntry.create).not.toHaveBeenCalled()
    })
  })
})
