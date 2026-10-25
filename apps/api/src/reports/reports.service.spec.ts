import { Test } from '@nestjs/testing'
import { ReportsService } from './reports.service'
import { PrismaService } from '../prisma/prisma.service'

describe('ReportsService', () => {
  let service: ReportsService
  let prisma: {
    financialLedgerEntry: { groupBy: jest.Mock }
    feeInvoice: { aggregate: jest.Mock }
    donation: { aggregate: jest.Mock }
    member: { count: jest.Mock; groupBy: jest.Mock; findMany: jest.Mock }
    family: { count: jest.Mock }
    familyArea: { groupBy: jest.Mock }
    area: { findMany: jest.Mock }
  }

  beforeEach(async () => {
    prisma = {
      financialLedgerEntry: { groupBy: jest.fn() },
      feeInvoice: { aggregate: jest.fn() },
      donation: { aggregate: jest.fn() },
      member: { count: jest.fn(), groupBy: jest.fn(), findMany: jest.fn() },
      family: { count: jest.fn() },
      familyArea: { groupBy: jest.fn() },
      area: { findMany: jest.fn() },
    }
    const moduleRef = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: prisma }],
    }).compile()
    service = moduleRef.get(ReportsService)
  })

  describe('financial', () => {
    it('computes outstanding as billed minus paid, and only counts paid donations', async () => {
      prisma.financialLedgerEntry.groupBy.mockResolvedValue([{ entryType: 'FEE', _sum: { netAmount: 500 }, _count: { _all: 3 } }])
      prisma.feeInvoice.aggregate.mockResolvedValue({ _sum: { amountBilled: 10_000, amountPaid: 7_500 } })
      prisma.donation.aggregate.mockResolvedValue({ _sum: { amount: 1_200 }, _count: { _all: 4 } })

      const report = await service.financial()

      expect(report.feeCollection).toEqual({ billed: 10_000, paid: 7_500, outstanding: 2_500 })
      expect(report.donations).toEqual({ totalPaidCount: 4, totalAmount: 1_200 })
      expect(prisma.donation.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { paymentTransactionId: { not: null } } }))
    })

    it('handles an empty ledger gracefully with all-zero totals', async () => {
      prisma.financialLedgerEntry.groupBy.mockResolvedValue([])
      prisma.feeInvoice.aggregate.mockResolvedValue({ _sum: { amountBilled: null, amountPaid: null } })
      prisma.donation.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } })

      const report = await service.financial()

      expect(report.feeCollection).toEqual({ billed: 0, paid: 0, outstanding: 0 })
      expect(report.donations.totalAmount).toBe(0)
    })
  })

  describe('demographics', () => {
    it('buckets members by age from date of birth, with no DOB falling into UNKNOWN', async () => {
      const now = new Date()
      const yearsAgo = (n: number) => new Date(now.getFullYear() - n, now.getMonth(), now.getDate())
      prisma.family.count.mockResolvedValue(2)
      prisma.member.count.mockResolvedValue(4)
      prisma.member.groupBy.mockResolvedValue([])
      prisma.member.findMany.mockResolvedValue([{ dateOfBirth: yearsAgo(10) }, { dateOfBirth: yearsAgo(25) }, { dateOfBirth: yearsAgo(70) }, { dateOfBirth: null }])
      prisma.familyArea.groupBy.mockResolvedValue([])
      prisma.area.findMany.mockResolvedValue([])

      const report = await service.demographics()

      const byBucket = Object.fromEntries(report.byAgeBucket.map((b) => [b.bucket, b.count]))
      expect(byBucket).toEqual({ '0-18': 1, '19-35': 1, '36-60': 0, '60+': 1, UNKNOWN: 1 })
    })
  })
})
