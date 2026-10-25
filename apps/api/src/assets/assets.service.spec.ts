import { Test } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { AssetsService } from './assets.service'
import { PrismaService } from '../prisma/prisma.service'
import { ApprovalsService } from '../common/approvals/approvals.service'

describe('AssetsService — pricing quote engine (docs/11 §4)', () => {
  let service: AssetsService
  let prisma: { asset: { findUnique: jest.Mock } }

  beforeEach(async () => {
    prisma = { asset: { findUnique: jest.fn() } }
    const moduleRef = await Test.createTestingModule({
      providers: [AssetsService, { provide: PrismaService, useValue: prisma }, { provide: ApprovalsService, useValue: { submit: jest.fn() } }],
    }).compile()
    service = moduleRef.get(AssetsService)
  })

  function baseAsset(overrides: Record<string, unknown> = {}) {
    return {
      id: 'asset-1',
      status: 'ACTIVE',
      deletedAt: null,
      taxPercent: 0,
      communityDiscountPercent: 0,
      pricing: [{ priceType: 'BASE', amount: 1000, validFrom: null, validTo: null }],
      services: [],
      ...overrides,
    }
  }

  it('uses BASE pricing on an ordinary weekday with no seasonal override', async () => {
    prisma.asset.findUnique.mockResolvedValue(baseAsset())
    const quote = await service.quote('asset-1', new Date('2027-03-16')) // Tuesday
    expect(quote.priceTypeUsed).toBe('BASE')
    expect(quote.basePrice).toBe(1000)
    expect(quote.total).toBe(1000)
  })

  it('prefers WEEKEND pricing over BASE on a Saturday/Sunday', async () => {
    prisma.asset.findUnique.mockResolvedValue(
      baseAsset({ pricing: [{ priceType: 'BASE', amount: 1000, validFrom: null, validTo: null }, { priceType: 'WEEKEND', amount: 1500, validFrom: null, validTo: null }] }),
    )
    const quote = await service.quote('asset-1', new Date('2027-03-20')) // Saturday
    expect(quote.priceTypeUsed).toBe('WEEKEND')
    expect(quote.basePrice).toBe(1500)
  })

  it('prefers SEASONAL pricing over both BASE and WEEKEND when the date falls in range', async () => {
    prisma.asset.findUnique.mockResolvedValue(
      baseAsset({
        pricing: [
          { priceType: 'BASE', amount: 1000, validFrom: null, validTo: null },
          { priceType: 'WEEKEND', amount: 1500, validFrom: null, validTo: null },
          { priceType: 'SEASONAL', amount: 3000, validFrom: new Date('2027-10-01'), validTo: new Date('2027-11-15') },
        ],
      }),
    )
    const quote = await service.quote('asset-1', new Date('2027-10-20')) // also a Wednesday, in-season
    expect(quote.priceTypeUsed).toBe('SEASONAL')
    expect(quote.basePrice).toBe(3000)
  })

  it('adds selected service line items to the subtotal', async () => {
    prisma.asset.findUnique.mockResolvedValue(
      baseAsset({ services: [{ code: 'CATERING', label: 'Catering', pricing: { amount: 200 } }, { code: 'DECOR', label: 'Decor', pricing: { amount: 100 } }] }),
    )
    const quote = await service.quote('asset-1', new Date('2027-03-16'), ['CATERING', 'DECOR'])
    expect(quote.serviceLines).toHaveLength(2)
    expect(quote.subtotal).toBe(1300)
    expect(quote.total).toBe(1300)
  })

  it('rejects an unknown or unpriced service code rather than silently ignoring it', async () => {
    prisma.asset.findUnique.mockResolvedValue(baseAsset())
    await expect(service.quote('asset-1', new Date('2027-03-16'), ['NOT_A_SERVICE'])).rejects.toBeInstanceOf(BadRequestException)
  })

  it('applies community discount before tax, both computed off the subtotal', async () => {
    prisma.asset.findUnique.mockResolvedValue(baseAsset({ communityDiscountPercent: 10, taxPercent: 18 }))
    const quote = await service.quote('asset-1', new Date('2027-03-16'))
    // subtotal 1000, discount 100 -> 900, tax 18% of 900 = 162 -> total 1062
    expect(quote.discount).toBe(100)
    expect(quote.tax).toBe(162)
    expect(quote.total).toBe(1062)
  })

  it('refuses to quote an asset with no pricing configured', async () => {
    prisma.asset.findUnique.mockResolvedValue(baseAsset({ pricing: [] }))
    await expect(service.quote('asset-1', new Date('2027-03-16'))).rejects.toBeInstanceOf(BadRequestException)
  })

  it('refuses to quote an asset that is not ACTIVE', async () => {
    prisma.asset.findUnique.mockResolvedValue(baseAsset({ status: 'PENDING_VERIFICATION' }))
    await expect(service.quote('asset-1', new Date('2027-03-16'))).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('AssetsService — search and date-blocking (docs/02-feature-map.md §8-10)', () => {
  let service: AssetsService
  let prisma: {
    asset: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock }
    assetBlockedDate: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock; delete: jest.Mock }
    review: { groupBy: jest.Mock }
  }

  beforeEach(async () => {
    prisma = {
      asset: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
      assetBlockedDate: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
      review: { groupBy: jest.fn() },
    }
    const moduleRef = await Test.createTestingModule({
      providers: [AssetsService, { provide: PrismaService, useValue: prisma }, { provide: ApprovalsService, useValue: { submit: jest.fn() } }],
    }).compile()
    service = moduleRef.get(AssetsService)
  })

  describe('search', () => {
    it('excludes an asset that is reserved or pending on the requested date/slot', async () => {
      prisma.asset.findMany.mockResolvedValue([])
      prisma.asset.count.mockResolvedValue(0)

      await service.search({ date: new Date('2027-05-01'), slot: 'FULL_DAY' })

      expect(prisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            availability: { none: { date: new Date('2027-05-01'), slot: 'FULL_DAY', status: { in: ['RESERVED', 'PENDING'] } } },
            blockedDates: { none: { dateFrom: { lte: new Date('2027-05-01') }, dateTo: { gte: new Date('2027-05-01') } } },
          }),
        }),
      )
    })

    it('AND-combines multiple required facilities rather than matching any one of them', async () => {
      prisma.asset.findMany.mockResolvedValue([])
      prisma.asset.count.mockResolvedValue(0)

      await service.search({ facilityCodes: ['PARKING', 'AC'] })

      expect(prisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ AND: [{ facilities: { some: { facilityCode: 'PARKING' } } }, { facilities: { some: { facilityCode: 'AC' } } }] }) }),
      )
    })

    it('filters by minimum average rating, computed from real review aggregates', async () => {
      prisma.asset.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
      prisma.review.groupBy.mockResolvedValue([{ assetId: 'a1', _avg: { overallScore: 4.5 } }, { assetId: 'a2', _avg: { overallScore: 2 } }])

      const result = await service.search({ minRating: 4 })

      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({ id: 'a1', averageRating: 4.5 })
    })

    it('treats an asset with no reviews at all as rating 0, excluded by any positive minRating', async () => {
      prisma.asset.findMany.mockResolvedValue([{ id: 'a1' }])
      prisma.review.groupBy.mockResolvedValue([])

      const result = await service.search({ minRating: 1 })

      expect(result.data).toHaveLength(0)
    })

    it('caps page size even if a huge value is requested', async () => {
      prisma.asset.findMany.mockResolvedValue([])
      prisma.asset.count.mockResolvedValue(0)

      await service.search({ pageSize: 10_000 })

      expect(prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))
    })
  })

  describe('owner date-blocking', () => {
    it('lets the owner block a date range', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', assetOwner: { userId: 'owner-1' } })
      prisma.assetBlockedDate.create.mockResolvedValue({ id: 'block-1' })

      await service.blockDates('owner-1', 'asset-1', { dateFrom: new Date('2027-01-01'), dateTo: new Date('2027-01-05') })

      expect(prisma.assetBlockedDate.create).toHaveBeenCalledWith({
        data: { assetId: 'asset-1', dateFrom: new Date('2027-01-01'), dateTo: new Date('2027-01-05'), reason: undefined },
      })
    })

    it('refuses a block range where dateTo is before dateFrom', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', assetOwner: { userId: 'owner-1' } })

      await expect(
        service.blockDates('owner-1', 'asset-1', { dateFrom: new Date('2027-01-05'), dateTo: new Date('2027-01-01') }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.assetBlockedDate.create).not.toHaveBeenCalled()
    })

    it("refuses to let someone who doesn't own the asset block its dates", async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', assetOwner: { userId: 'someone-else' } })

      await expect(
        service.blockDates('owner-1', 'asset-1', { dateFrom: new Date('2027-01-01'), dateTo: new Date('2027-01-05') }),
      ).rejects.toThrow()
    })

    it('lets the owner remove a blocked range it actually owns', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', assetOwner: { userId: 'owner-1' } })
      prisma.assetBlockedDate.findUnique.mockResolvedValue({ id: 'block-1', assetId: 'asset-1' })

      const result = await service.unblockDates('owner-1', 'asset-1', 'block-1')

      expect(prisma.assetBlockedDate.delete).toHaveBeenCalledWith({ where: { id: 'block-1' } })
      expect(result).toEqual({ removed: true })
    })

    it('404s when the blocked-date row does not belong to this asset', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', assetOwner: { userId: 'owner-1' } })
      prisma.assetBlockedDate.findUnique.mockResolvedValue({ id: 'block-1', assetId: 'some-other-asset' })

      await expect(service.unblockDates('owner-1', 'asset-1', 'block-1')).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.assetBlockedDate.delete).not.toHaveBeenCalled()
    })
  })
})
