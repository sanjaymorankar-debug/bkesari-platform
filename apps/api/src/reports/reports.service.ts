import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const AGE_BUCKETS = ['0-18', '19-35', '36-60', '60+', 'UNKNOWN'] as const

function ageBucket(dateOfBirth: Date | null): (typeof AGE_BUCKETS)[number] {
  if (!dateOfBirth) return 'UNKNOWN'
  const ageMs = Date.now() - dateOfBirth.getTime()
  const age = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000))
  if (age <= 18) return '0-18'
  if (age <= 35) return '19-35'
  if (age <= 60) return '36-60'
  return '60+'
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async demographics() {
    const [totalFamilies, totalMembers, byGender, byMaritalStatus, byStatus, dobs, byArea] = await Promise.all([
      this.prisma.family.count({ where: { deletedAt: null } }),
      this.prisma.member.count({ where: { deletedAt: null } }),
      this.prisma.member.groupBy({ by: ['gender'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.member.groupBy({ by: ['maritalStatus'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.member.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.member.findMany({ where: { deletedAt: null }, select: { dateOfBirth: true } }),
      this.prisma.familyArea.groupBy({ by: ['areaId'], _count: { _all: true } }),
    ])

    const ageCounts: Record<string, number> = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0]))
    for (const { dateOfBirth } of dobs) ageCounts[ageBucket(dateOfBirth)]++

    const areaIds = byArea.map((a) => a.areaId)
    const areas = await this.prisma.area.findMany({ where: { id: { in: areaIds } }, select: { id: true, name: true } })
    const areaNameById = new Map(areas.map((a) => [a.id, a.name]))

    return {
      totalFamilies,
      totalMembers,
      byGender: byGender.map((g) => ({ gender: g.gender, count: g._count._all })),
      byMaritalStatus: byMaritalStatus.map((m) => ({ maritalStatus: m.maritalStatus, count: m._count._all })),
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
      byAgeBucket: AGE_BUCKETS.map((bucket) => ({ bucket, count: ageCounts[bucket] })),
      byArea: byArea.map((a) => ({ area: areaNameById.get(a.areaId) ?? 'Unknown', count: a._count._all })),
    }
  }

  async matrimony() {
    const [totalProfiles, visibleProfiles, byInterestStatus, totalInterests] = await Promise.all([
      this.prisma.matrimonyProfile.count(),
      this.prisma.matrimonyProfile.count({ where: { isVisible: true } }),
      this.prisma.matrimonyInterest.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.matrimonyInterest.count(),
    ])

    return {
      totalProfiles,
      visibleProfiles,
      totalInterests,
      byInterestStatus: byInterestStatus.map((s) => ({ status: s.status, count: s._count._all })),
    }
  }

  async services() {
    const [categories, assetsByCategory, assetsByStatus, bookingsByStatus, revenueByAsset] = await Promise.all([
      this.prisma.assetCategory.findMany({ select: { id: true, label: true } }),
      this.prisma.asset.groupBy({ by: ['categoryId'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.asset.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.booking.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.booking.groupBy({ by: ['assetId'], where: { status: 'COMPLETED' }, _sum: { totalAmount: true }, orderBy: { _sum: { totalAmount: 'desc' } }, take: 20 }),
    ])

    const categoryLabelById = new Map(categories.map((c) => [c.id, c.label]))
    const assetIds = revenueByAsset.map((r) => r.assetId)
    const assets = await this.prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, name: true } })
    const assetNameById = new Map(assets.map((a) => [a.id, a.name]))

    return {
      assetsByCategory: assetsByCategory.map((a) => ({ category: categoryLabelById.get(a.categoryId) ?? 'Unknown', count: a._count._all })),
      assetsByStatus: assetsByStatus.map((a) => ({ status: a.status, count: a._count._all })),
      bookingsByStatus: bookingsByStatus.map((b) => ({ status: b.status, count: b._count._all })),
      topAssetsByRevenue: revenueByAsset.map((r) => ({ asset: assetNameById.get(r.assetId) ?? 'Unknown', revenue: Number(r._sum.totalAmount ?? 0) })),
    }
  }

  async financial() {
    const [byEntryType, feeTotals, donationTotals] = await Promise.all([
      this.prisma.financialLedgerEntry.groupBy({ by: ['entryType'], _sum: { netAmount: true }, _count: { _all: true } }),
      this.prisma.feeInvoice.aggregate({ _sum: { amountBilled: true, amountPaid: true } }),
      this.prisma.donation.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { paymentTransactionId: { not: null } } }),
    ])

    const billed = Number(feeTotals._sum.amountBilled ?? 0)
    const paid = Number(feeTotals._sum.amountPaid ?? 0)

    return {
      ledgerByEntryType: byEntryType.map((e) => ({ entryType: e.entryType, count: e._count._all, netAmount: Number(e._sum.netAmount ?? 0) })),
      feeCollection: { billed, paid, outstanding: billed - paid },
      donations: { totalPaidCount: donationTotals._count._all, totalAmount: Number(donationTotals._sum.amount ?? 0) },
    }
  }
}
