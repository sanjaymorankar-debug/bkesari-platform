import { Test } from '@nestjs/testing'
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { BookingsService } from './bookings.service'
import { PrismaService } from '../prisma/prisma.service'
import { AssetsService } from '../assets/assets.service'
import { NotificationsService } from '../notifications/notifications.service'

describe('BookingsService', () => {
  let service: BookingsService
  let prisma: {
    asset: { findUnique: jest.Mock }
    assetOwner: { findUnique: jest.Mock }
    assetBlockedDate: { findFirst: jest.Mock }
    booking: { findUnique: jest.Mock; update: jest.Mock }
    bookingStatusHistory: { create: jest.Mock }
    assetAvailability: { create: jest.Mock; update: jest.Mock; updateMany: jest.Mock }
    userRole: { count: jest.Mock }
    $transaction: jest.Mock
  }
  let assets: { quote: jest.Mock }
  let notifications: { notify: jest.Mock }

  beforeEach(async () => {
    prisma = {
      asset: { findUnique: jest.fn() },
      assetOwner: { findUnique: jest.fn() },
      assetBlockedDate: { findFirst: jest.fn().mockResolvedValue(null) },
      booking: { findUnique: jest.fn(), update: jest.fn() },
      bookingStatusHistory: { create: jest.fn() },
      assetAvailability: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      userRole: { count: jest.fn() },
      $transaction: jest.fn(),
    }
    assets = { quote: jest.fn() }
    notifications = { notify: jest.fn() }

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AssetsService, useValue: assets },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile()

    service = moduleRef.get(BookingsService)
  })

  describe('owner-blocked dates are respected at booking time, not just in search', () => {
    it('refuses a booking on a date the owner has blocked, before ever touching the availability lock', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', status: 'ACTIVE', deletedAt: null, bookingApprovalRequired: false })
      prisma.assetBlockedDate.findFirst.mockResolvedValue({ id: 'block-1' })

      await expect(service.createBooking('user-1', { assetId: 'asset-1', date: new Date('2026-12-25') } as never)).rejects.toBeInstanceOf(
        ConflictException,
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('double-booking prevention (lock-then-check-then-write ordering)', () => {
    function makeTx(lockedRow: { id: string; status: string } | undefined) {
      return {
        assetAvailability: { createMany: jest.fn().mockResolvedValue({ count: 0 }), update: jest.fn().mockResolvedValue({}) },
        $queryRaw: jest.fn().mockResolvedValue(lockedRow ? [lockedRow] : []),
        booking: { create: jest.fn().mockResolvedValue({ id: 'booking-1' }) },
      }
    }

    it('rejects the booking when the locked row is not AVAILABLE, without ever writing a booking row', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', status: 'ACTIVE', deletedAt: null, bookingApprovalRequired: false, assetOwnerId: 'owner-1' })
      assets.quote.mockResolvedValue({ total: 1000, basePrice: 1000, priceTypeUsed: 'BASE', serviceLines: [] })
      const tx = makeTx({ id: 'avail-1', status: 'RESERVED' })
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await expect(
        service.createBooking('user-1', { assetId: 'asset-1', date: new Date('2026-12-25') } as never),
      ).rejects.toBeInstanceOf(ConflictException)

      expect(tx.booking.create).not.toHaveBeenCalled()
      expect(tx.assetAvailability.update).not.toHaveBeenCalled()
    })

    it('confirms the booking and flips the slot to RESERVED when the locked row is AVAILABLE (instant asset)', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', name: 'Hall', status: 'ACTIVE', deletedAt: null, bookingApprovalRequired: false, assetOwnerId: 'owner-1' })
      assets.quote.mockResolvedValue({ total: 1000, basePrice: 1000, priceTypeUsed: 'BASE', serviceLines: [] })
      prisma.assetOwner.findUnique.mockResolvedValue({ id: 'owner-1', userId: 'owner-user' })
      const tx = makeTx({ id: 'avail-1', status: 'AVAILABLE' })
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      const result = await service.createBooking('user-1', { assetId: 'asset-1', date: new Date('2026-12-25') } as never)

      expect(tx.assetAvailability.update).toHaveBeenCalledWith({ where: { id: 'avail-1' }, data: { status: 'RESERVED' } })
      expect(result).toEqual({ id: 'booking-1' })
    })

    it('flips the slot to PENDING (not RESERVED) when the asset requires owner approval', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', name: 'Hall', status: 'ACTIVE', deletedAt: null, bookingApprovalRequired: true, assetOwnerId: 'owner-1' })
      assets.quote.mockResolvedValue({ total: 1000, basePrice: 1000, priceTypeUsed: 'BASE', serviceLines: [] })
      prisma.assetOwner.findUnique.mockResolvedValue({ id: 'owner-1', userId: 'owner-user' })
      const tx = makeTx({ id: 'avail-1', status: 'AVAILABLE' })
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await service.createBooking('user-1', { assetId: 'asset-1', date: new Date('2026-12-25') } as never)

      expect(tx.assetAvailability.update).toHaveBeenCalledWith({ where: { id: 'avail-1' }, data: { status: 'PENDING' } })
    })

    it('proceeds to lock even when the availability row did not exist yet (create-if-missing before the lock)', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', name: 'Hall', status: 'ACTIVE', deletedAt: null, bookingApprovalRequired: false, assetOwnerId: 'owner-1' })
      assets.quote.mockResolvedValue({ total: 500, basePrice: 500, priceTypeUsed: 'BASE', serviceLines: [] })
      prisma.assetOwner.findUnique.mockResolvedValue(null)
      const tx = makeTx({ id: 'avail-new', status: 'AVAILABLE' })
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await service.createBooking('user-1', { assetId: 'asset-1', date: new Date('2026-12-25') } as never)

      // ON CONFLICT DO NOTHING, never a caught duplicate-key error: on
      // PostgreSQL that error would abort the transaction before the lock.
      expect(tx.assetAvailability.createMany).toHaveBeenCalledWith({
        data: [{ assetId: 'asset-1', date: new Date('2026-12-25'), slot: 'FULL_DAY', status: 'AVAILABLE' }],
        skipDuplicates: true,
      })
      expect(tx.assetAvailability.createMany.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0])
    })

    it('refuses to book an asset that is not ACTIVE', async () => {
      prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', status: 'PENDING_VERIFICATION', deletedAt: null })
      await expect(service.createBooking('user-1', { assetId: 'asset-1', date: new Date() } as never)).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('booking state machine transitions', () => {
    it('lets the asset owner approve a REQUESTED request-type booking', async () => {
      prisma.booking.findUnique.mockResolvedValue({ id: 'b1', status: 'REQUESTED', userId: 'renter-1', assetId: 'asset-1', date: new Date(), slot: 'FULL_DAY', asset: { assetOwner: { userId: 'owner-user' } } })
      const tx = { booking: { update: jest.fn().mockResolvedValue({ id: 'b1', status: 'APPROVED' }) }, bookingStatusHistory: { create: jest.fn() }, assetAvailability: { updateMany: jest.fn() } }
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await service.decideRequest('owner-user', 'b1', 'APPROVED')

      expect(tx.booking.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { status: 'APPROVED' } })
      expect(tx.assetAvailability.updateMany).not.toHaveBeenCalled()
    })

    it('releases the availability slot when the owner declines a request', async () => {
      prisma.booking.findUnique.mockResolvedValue({ id: 'b1', status: 'REQUESTED', userId: 'renter-1', assetId: 'asset-1', date: new Date(), slot: 'FULL_DAY', asset: { assetOwner: { userId: 'owner-user' } } })
      const tx = { booking: { update: jest.fn().mockResolvedValue({ id: 'b1', status: 'DECLINED' }) }, bookingStatusHistory: { create: jest.fn() }, assetAvailability: { updateMany: jest.fn() } }
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await service.decideRequest('owner-user', 'b1', 'DECLINED')

      expect(tx.assetAvailability.updateMany).toHaveBeenCalledWith({
        where: { assetId: 'asset-1', date: expect.any(Date), slot: 'FULL_DAY' },
        data: { status: 'AVAILABLE' },
      })
    })

    it('refuses to let anyone but the asset owner decide a request', async () => {
      prisma.booking.findUnique.mockResolvedValue({ id: 'b1', status: 'REQUESTED', asset: { assetOwner: { userId: 'owner-user' } } })
      await expect(service.decideRequest('someone-else', 'b1', 'APPROVED')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('refuses to decide a booking that is not REQUESTED', async () => {
      prisma.booking.findUnique.mockResolvedValue({ id: 'b1', status: 'CONFIRMED', asset: { assetOwner: { userId: 'owner-user' } } })
      await expect(service.decideRequest('owner-user', 'b1', 'APPROVED')).rejects.toBeInstanceOf(ConflictException)
    })

    it('confirms payment only from the expected pre-payment status for the booking type', async () => {
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        status: 'CONFIRMED',
        userId: 'renter-1',
        bookingType: 'INSTANT',
        createdAt: new Date(),
        asset: { assetOwner: { userId: 'owner-user' } },
      })
      await expect(service.confirmPayment('renter-1', 'b1')).rejects.toBeInstanceOf(ConflictException)
    })

    it('expires a stale REQUESTED booking instead of letting it be paid for', async () => {
      const staleDate = new Date(Date.now() - 25 * 3_600_000)
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        status: 'REQUESTED',
        userId: 'renter-1',
        bookingType: 'INSTANT',
        createdAt: staleDate,
        assetId: 'asset-1',
        date: new Date(),
        slot: 'FULL_DAY',
        asset: { assetOwner: { userId: 'owner-user' } },
      })
      const tx = { booking: { update: jest.fn() }, bookingStatusHistory: { create: jest.fn() }, assetAvailability: { updateMany: jest.fn() } }
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await expect(service.confirmPayment('renter-1', 'b1')).rejects.toBeInstanceOf(ConflictException)
      expect(tx.booking.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { status: 'EXPIRED' } })
      expect(tx.assetAvailability.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'AVAILABLE' } }),
      )
    })

    it('only the booking owner can cancel it', async () => {
      prisma.booking.findUnique.mockResolvedValue({ id: 'b1', status: 'CONFIRMED', userId: 'renter-1', asset: {} })
      await expect(service.cancelBooking('someone-else', 'b1')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('refuses to cancel a booking already in a terminal state', async () => {
      prisma.booking.findUnique.mockResolvedValue({ id: 'b1', status: 'COMPLETED', userId: 'renter-1', asset: {} })
      await expect(service.cancelBooking('renter-1', 'b1')).rejects.toBeInstanceOf(ConflictException)
    })

    it('only a confirmed booking can be marked complete', async () => {
      prisma.booking.findUnique.mockResolvedValue({ id: 'b1', status: 'APPROVED', asset: { assetOwner: { userId: 'owner-user' } } })
      await expect(service.completeBooking('owner-user', 'b1')).rejects.toBeInstanceOf(ConflictException)
    })
  })
})
