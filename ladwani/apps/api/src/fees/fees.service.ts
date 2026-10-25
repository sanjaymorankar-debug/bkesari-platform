import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { Approval, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ApprovalsService } from '../common/approvals/approvals.service'
import { NotificationsService } from '../notifications/notifications.service'
import { FamilyAuthorizationService } from '../common/family-authorization/family-authorization.service'
import { CreateFeeTypeDto } from './dto/create-fee-type.dto'
import { CreateFinancialYearDto } from './dto/create-financial-year.dto'
import { CreateFeeRuleDto } from './dto/create-fee-rule.dto'
import { AssignFeeDto } from './dto/assign-fee.dto'
import { RecordOfflinePaymentDto } from './dto/record-offline-payment.dto'
import { CreateWaiverDto } from './dto/create-waiver.dto'

type Tx = Prisma.TransactionClient

const DEFAULT_DUE_DAYS = 30

@Injectable()
export class FeesService {
  constructor(
    private prisma: PrismaService,
    private approvals: ApprovalsService,
    private notifications: NotificationsService,
    private familyAuth: FamilyAuthorizationService,
  ) {}

  async createFeeType(dto: CreateFeeTypeDto) {
    return this.prisma.communityFeeType.create({ data: dto })
  }

  async createFinancialYear(dto: CreateFinancialYearDto) {
    return this.prisma.financialYear.create({ data: dto })
  }

  async createFeeRule(dto: CreateFeeRuleDto) {
    const feeType = await this.prisma.communityFeeType.findUnique({ where: { code: dto.feeTypeCode } })
    if (!feeType) throw new NotFoundException('Unknown fee type.')
    const financialYear = await this.prisma.financialYear.findUnique({ where: { label: dto.financialYearLabel } })
    if (!financialYear) throw new NotFoundException('Unknown financial year.')

    return this.prisma.feeRule.create({
      data: {
        feeTypeId: feeType.id,
        financialYearId: financialYear.id,
        amount: dto.amount,
        areaId: dto.areaId,
        lateFeeAmount: dto.lateFeeAmount ?? 0,
        gracePeriodDays: dto.gracePeriodDays ?? 0,
      },
    })
  }

  async listFeeRules() {
    return this.prisma.feeRule.findMany({ include: { feeType: true, financialYear: true }, orderBy: { financialYear: { startDate: 'desc' } } })
  }

  /** Assigning a fee rule to a family immediately bills it — J8 opens with the invoice already sitting in the Karta's queue. */
  async assignToFamily(dto: AssignFeeDto) {
    const feeRule = await this.prisma.feeRule.findUnique({ where: { id: dto.feeRuleId } })
    if (!feeRule) throw new NotFoundException('Fee rule not found.')
    const family = await this.prisma.family.findUnique({ where: { id: dto.familyId } })
    if (!family || family.deletedAt) throw new NotFoundException('Family not found.')

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.familyFeeAssignment.upsert({
        where: { familyId_feeRuleId: { familyId: dto.familyId, feeRuleId: dto.feeRuleId } },
        update: {},
        create: { familyId: dto.familyId, feeRuleId: dto.feeRuleId, effectiveDate: dto.effectiveDate ?? new Date() },
      })

      const dueDate = dto.dueDate ?? new Date(Date.now() + DEFAULT_DUE_DAYS * 86_400_000)
      const invoice = await tx.feeInvoice.create({
        data: {
          familyId: dto.familyId,
          feeRuleId: dto.feeRuleId,
          financialYearId: feeRule.financialYearId,
          amountBilled: feeRule.amount,
          dueDate,
          items: { create: [{ description: 'Fee', amount: feeRule.amount }] },
        },
      })

      if (family.kartaMemberId) {
        const karta = await tx.member.findUnique({ where: { id: family.kartaMemberId } })
        if (karta?.userId) {
          await this.notifications.notify(
            { recipientId: karta.userId, type: 'fee.invoice.created', title: 'New fee invoice', body: `${family.name} has a new invoice of ₹${Number(feeRule.amount).toLocaleString('en-IN')}.`, data: { invoiceId: invoice.id } },
            tx,
          )
        }
      }

      return { assignment, invoice }
    })
  }

  async listInvoicesForFamily(familyId: string) {
    const invoices = await this.prisma.feeInvoice.findMany({
      where: { familyId },
      include: { feeRule: { include: { feeType: true } }, waivers: true, offlinePayments: true },
      orderBy: { createdAt: 'desc' },
    })
    return invoices.map((inv) => this.withComputedFields(inv))
  }

  async getInvoice(invoiceId: string) {
    const invoice = await this.prisma.feeInvoice.findUnique({
      where: { id: invoiceId },
      include: { feeRule: { include: { feeType: true } }, items: true, waivers: true, offlinePayments: true, family: true },
    })
    if (!invoice) throw new NotFoundException('Invoice not found.')
    return this.withComputedFields(invoice)
  }

  /** J8: Karta pays via the real gateway flow — this just returns the outstanding amount; PaymentsService.createOrder does the rest. */
  async getOutstandingAmount(invoiceId: string): Promise<number> {
    const invoice = await this.getInvoice(invoiceId)
    if (invoice.status === 'PAID' || invoice.status === 'WAIVED') throw new ConflictException('This invoice is already settled.')
    return invoice.outstanding
  }

  async assertKartaOfInvoiceFamily(userId: string, invoiceId: string): Promise<void> {
    const invoice = await this.prisma.feeInvoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) throw new NotFoundException('Invoice not found.')
    await this.familyAuth.assertIsKarta(userId, invoice.familyId)
  }

  /**
   * Called by PaymentDispatchService once a gateway payment for purposeType=FEE
   * is verified. paymentTransactionId links back to the generic ledger entry
   * PaymentsService.applySuccessfulPayment already wrote for this transaction —
   * enriched here with the invoice/family it actually paid for.
   */
  async applyPayment(tx: Tx, invoiceId: string, amount: number, paymentTransactionId: string): Promise<void> {
    const invoice = await tx.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } })
    const newPaid = Number(invoice.amountPaid) + amount
    await tx.feeInvoice.update({
      where: { id: invoiceId },
      data: { amountPaid: newPaid, status: newPaid >= Number(invoice.amountBilled) ? 'PAID' : 'PARTIAL' },
    })
    await tx.financialLedgerEntry.updateMany({
      where: { paymentTransactionId },
      data: { feeInvoiceId: invoiceId, familyId: invoice.familyId, financialYearId: invoice.financialYearId },
    })
  }

  async recordOfflinePayment(karta: string, invoiceId: string, dto: RecordOfflinePaymentDto) {
    await this.assertKartaOfInvoiceFamily(karta, invoiceId)
    const invoice = await this.prisma.feeInvoice.findUniqueOrThrow({ where: { id: invoiceId } })
    if (invoice.status === 'PAID' || invoice.status === 'WAIVED') throw new ConflictException('This invoice is already settled.')

    return this.prisma.offlinePayment.create({
      data: { feeInvoiceId: invoiceId, amount: dto.amount, method: dto.method, reference: dto.reference, recordedBy: karta, status: 'PENDING_VERIFICATION' },
    })
  }

  /** Never the payer — routed through the approval engine like every other sensitive action, per docs/12 §4's `offline_payment.verify` rule (Operator/Admin). */
  async submitOfflinePaymentForVerification(operatorFacingSubmitterId: string, offlinePaymentId: string) {
    const offlinePayment = await this.prisma.offlinePayment.findUnique({ where: { id: offlinePaymentId } })
    if (!offlinePayment) throw new NotFoundException('Offline payment record not found.')
    return this.approvals.submit({
      actionCode: 'offline_payment.verify',
      entityType: 'OfflinePayment',
      entityId: offlinePaymentId,
      submittedBy: operatorFacingSubmitterId,
    })
  }

  async applyOfflinePaymentApproval(tx: Tx, approval: Approval): Promise<void> {
    if (!approval.entityId) return
    const offlinePayment = await tx.offlinePayment.findUniqueOrThrow({ where: { id: approval.entityId } })

    if (approval.status === 'APPROVED') {
      await tx.offlinePayment.update({ where: { id: approval.entityId }, data: { status: 'VERIFIED', verifiedBy: approval.reviewedBy, verifiedAt: new Date() } })
      const invoice = await tx.feeInvoice.findUniqueOrThrow({ where: { id: offlinePayment.feeInvoiceId } })
      const newPaid = Number(invoice.amountPaid) + Number(offlinePayment.amount)
      await tx.feeInvoice.update({
        where: { id: offlinePayment.feeInvoiceId },
        data: { amountPaid: newPaid, status: newPaid >= Number(invoice.amountBilled) ? 'PAID' : 'PARTIAL' },
      })
      await tx.financialLedgerEntry.create({
        data: { entryType: 'FEE', feeInvoiceId: offlinePayment.feeInvoiceId, amount: offlinePayment.amount, netAmount: offlinePayment.amount, createdBy: approval.reviewedBy },
      })
    } else if (approval.status === 'REJECTED') {
      await tx.offlinePayment.update({ where: { id: approval.entityId }, data: { status: 'REJECTED', verifiedBy: approval.reviewedBy, verifiedAt: new Date() } })
    }
  }

  async createWaiver(actorUserId: string, invoiceId: string, dto: CreateWaiverDto) {
    const invoice = await this.prisma.feeInvoice.findUnique({ where: { id: invoiceId } })
    if (!invoice) throw new NotFoundException('Invoice not found.')
    if (dto.reductionAmount > Number(invoice.amountBilled) - Number(invoice.amountPaid)) {
      throw new BadRequestException('Reduction cannot exceed the outstanding balance.')
    }

    return this.prisma.$transaction(async (tx) => {
      const waiver = await tx.feeWaiver.create({
        data: { feeInvoiceId: invoiceId, type: dto.type, originalAmount: invoice.amountBilled, reductionAmount: dto.reductionAmount, reason: dto.reason, approvedBy: actorUserId },
      })
      const remaining = Number(invoice.amountBilled) - Number(invoice.amountPaid) - dto.reductionAmount
      await tx.feeInvoice.update({ where: { id: invoiceId }, data: { status: remaining <= 0 ? 'WAIVED' : invoice.status } })
      return waiver
    })
  }

  private withComputedFields<T extends { amountBilled: unknown; amountPaid: unknown; dueDate: Date; status: string; feeRule: { lateFeeAmount: unknown; gracePeriodDays: number }; waivers: { reductionAmount: unknown }[] }>(
    invoice: T,
  ) {
    const billed = Number(invoice.amountBilled)
    const paid = Number(invoice.amountPaid)
    const waived = invoice.waivers.reduce((sum, w) => sum + Number(w.reductionAmount), 0)
    const lateFee = this.computeLateFee(invoice.dueDate, invoice.feeRule.gracePeriodDays, Number(invoice.feeRule.lateFeeAmount), invoice.status)
    const outstanding = Math.max(0, billed + lateFee - paid - waived)
    return { ...invoice, lateFee, outstanding }
  }

  private computeLateFee(dueDate: Date, gracePeriodDays: number, lateFeeAmount: number, status: string): number {
    if (status === 'PAID' || status === 'WAIVED') return 0
    const graceDeadline = new Date(dueDate.getTime() + gracePeriodDays * 86_400_000)
    return Date.now() > graceDeadline.getTime() ? lateFeeAmount : 0
  }
}
