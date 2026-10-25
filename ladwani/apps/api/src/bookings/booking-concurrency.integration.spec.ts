import { randomBytes } from 'crypto'
import { ConflictException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AssetsService } from '../assets/assets.service'
import { BookingsService } from '../bookings/bookings.service'
import { NotificationsService } from '../notifications/notifications.service'

/**
 * Real-database concurrency test for docs/11-booking-architecture.md §2 —
 * the roadmap explicitly calls this out as "the one to actually load-test,
 * not just unit-test." Fires N concurrent booking attempts for the exact
 * same (asset, date, slot) against a live PostgreSQL instance and asserts the
 * SELECT ... FOR UPDATE lock serializes them: exactly one wins, the rest
 * fail cleanly, and the database never ends up with two bookings holding
 * the same slot.
 *
 * Requires a real DATABASE_URL against a throwaway database — this suite
 * creates and deletes users, assets and bookings. Locally, copy
 * apps/api/.env.test.example to apps/api/.env.test and run `npm run
 * test:local` from the repo root, which migrates the database first. In CI
 * the postgres service supplies DATABASE_URL, so `npm run test:integration`
 * is enough there. Either way, not the default `npm test`.
 */
describe('Booking concurrency (real PostgreSQL)', () => {
  const prisma = new PrismaService()
  const notifications = new NotificationsService(prisma)
  const assetsService = new AssetsService(prisma, { submit: async () => ({ status: 'APPROVED' }) } as never)
  const bookingsService = new BookingsService(prisma, assetsService, notifications)

  let categoryId: string
  let assetId: string
  let ownerUserId: string
  const userIds: string[] = []
  const CONCURRENCY = 10

  beforeAll(async () => {
    const suffix = randomBytes(4).toString('hex')

    const category = await prisma.assetCategory.upsert({
      where: { code: `TEST_CATEGORY_${suffix}` },
      update: {},
      create: { code: `TEST_CATEGORY_${suffix}`, label: 'Test Category' },
    })
    categoryId = category.id

    const ownerUser = await prisma.user.create({
      data: { mobile: `9${suffix.slice(0, 9)}`, passwordHash: 'x', status: 'ACTIVE' },
    })
    ownerUserId = ownerUser.id
    const assetOwner = await prisma.assetOwner.create({ data: { userId: ownerUser.id } })

    const asset = await prisma.asset.create({
      data: {
        assetOwnerId: assetOwner.id,
        categoryId,
        name: `Test Hall ${suffix}`,
        status: 'ACTIVE',
        bookingApprovalRequired: false,
        pricing: { create: { priceType: 'BASE', amount: 5000 } },
      },
    })
    assetId = asset.id

    for (let i = 0; i < CONCURRENCY; i++) {
      const user = await prisma.user.create({
        data: { mobile: `8${suffix.slice(0, 8)}${i}`, passwordHash: 'x', status: 'ACTIVE' },
      })
      userIds.push(user.id)
    }
  }, 30_000)

  afterAll(async () => {
    await prisma.bookingStatusHistory.deleteMany({ where: { booking: { assetId } } })
    await prisma.bookingItem.deleteMany({ where: { booking: { assetId } } })
    await prisma.booking.deleteMany({ where: { assetId } })
    await prisma.assetAvailability.deleteMany({ where: { assetId } })
    await prisma.assetPricing.deleteMany({ where: { assetId } })
    await prisma.asset.delete({ where: { id: assetId } })
    await prisma.user.delete({ where: { id: ownerUserId } }) // cascades to the AssetOwner row
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
    await prisma.assetCategory.delete({ where: { id: categoryId } }).catch(() => undefined)
    await prisma.$disconnect()
  }, 30_000)

  it('lets exactly one of N concurrent booking attempts for the same slot succeed', async () => {
    const date = new Date('2027-06-15')

    const results = await Promise.allSettled(
      userIds.map((userId) => bookingsService.createBooking(userId, { assetId, date, slot: 'FULL_DAY' } as never)),
    )

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(CONCURRENCY - 1)
    // Every loser is told the slot is taken. On PostgreSQL a failed statement
    // aborts the whole transaction, so a loser that tripped over the unique
    // key and carried on would surface a database error (a 500) instead.
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException)
    }

    const bookingsForSlot = await prisma.booking.findMany({ where: { assetId, date, slot: 'FULL_DAY' } })
    expect(bookingsForSlot).toHaveLength(1)

    const availability = await prisma.assetAvailability.findUnique({
      where: { assetId_date_slot: { assetId, date, slot: 'FULL_DAY' } },
    })
    expect(availability?.status).toBe('RESERVED')
  }, 60_000)

  it('books a slot whose availability row already exists and is AVAILABLE', async () => {
    // How a slot looks after a declined request or a cancellation: the row
    // stays, back at AVAILABLE.
    const date = new Date('2027-06-16')
    await prisma.assetAvailability.create({ data: { assetId, date, slot: 'FULL_DAY', status: 'AVAILABLE' } })

    const booking = await bookingsService.createBooking(userIds[0], { assetId, date, slot: 'FULL_DAY' } as never)
    expect(booking.status).toBe('REQUESTED')

    const availability = await prisma.assetAvailability.findUnique({
      where: { assetId_date_slot: { assetId, date, slot: 'FULL_DAY' } },
    })
    expect(availability?.status).toBe('RESERVED')

    await expect(
      bookingsService.createBooking(userIds[1], { assetId, date, slot: 'FULL_DAY' } as never),
    ).rejects.toBeInstanceOf(ConflictException)
  }, 30_000)
})
