import { createHmac } from 'crypto'
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AssetsService } from '../assets/assets.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CreateBookingDto } from './dto/create-booking.dto'

const PAYMENT_WINDOW_HOURS = 24

@Injectable()
export class BookingsService {
  private readonly qrSecret = process.env.JWT_SECRET ?? 'dev-secret-change-in-production'

  constructor(
    private prisma: PrismaService,
    private assets: AssetsService,
    private notifications: NotificationsService,
  ) {}

  /**
   * Prevents double-booking per docs/11-booking-architecture.md §2: a row is
   * created (or already exists) for this (asset, date, slot), then locked
   * with SELECT ... FOR UPDATE inside the same transaction before the status
   * is checked and flipped — two concurrent attempts serialize at the
   * database, the loser sees the committed AVAILABLE→(taken) status and
   * fails cleanly instead of racing on a check-then-write.
   */
  async createBooking(userId: string, dto: CreateBookingDto) {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } })
    if (!asset || asset.deletedAt || asset.status !== 'ACTIVE') throw new NotFoundException('Asset not found or not bookable.')

    const blocked = await this.prisma.assetBlockedDate.findFirst({
      where: { assetId: dto.assetId, dateFrom: { lte: dto.date }, dateTo: { gte: dto.date } },
    })
    if (blocked) throw new ConflictException('The owner has blocked this date for booking.')

    const slot = dto.slot ?? 'FULL_DAY'
    const quote = await this.assets.quote(dto.assetId, dto.date, dto.serviceCodes ?? [])
    const bookingType = asset.bookingApprovalRequired ? 'REQUEST' : 'INSTANT'

    const booking = await this.prisma.$transaction(async (tx) => {
      // Make sure the slot's row exists so there is something to lock. This is
      // INSERT ... ON CONFLICT DO NOTHING: on PostgreSQL a failed statement
      // aborts the whole transaction, so catching a duplicate-key error here
      // would leave the SELECT below unable to run.
      await tx.assetAvailability.createMany({
        data: [{ assetId: dto.assetId, date: dto.date, slot, status: 'AVAILABLE' }],
        skipDuplicates: true,
      })

      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM asset_availability
        WHERE asset_id = ${dto.assetId} AND date = ${dto.date} AND slot = ${slot}
        FOR UPDATE
      `
      const row = locked[0]
      if (!row || row.status !== 'AVAILABLE') {
        throw new ConflictException('This date/slot is no longer available.')
      }

      await tx.assetAvailability.update({ where: { id: row.id }, data: { status: bookingType === 'INSTANT' ? 'RESERVED' : 'PENDING' } })

      return tx.booking.create({
        data: {
          assetId: dto.assetId,
          userId,
          status: 'REQUESTED',
          bookingType,
          date: dto.date,
          slot,
          totalAmount: quote.total,
          items: {
            create: [
              { itemType: 'BASE', description: `Base price (${quote.priceTypeUsed})`, unitPrice: quote.basePrice },
              ...quote.serviceLines.map((l) => ({ itemType: 'SERVICE', description: l.label, unitPrice: l.amount })),
            ],
          },
          guests: dto.guests?.length ? { create: dto.guests } : undefined,
          statusHistory: { create: { toStatus: 'REQUESTED', changedBy: userId } },
        },
      })
    })

    const owner = await this.prisma.assetOwner.findUnique({ where: { id: asset.assetOwnerId } })
    if (owner) {
      await this.notifications.notify({
        recipientId: owner.userId,
        senderId: userId,
        type: bookingType === 'REQUEST' ? 'booking.request.received' : 'booking.created',
        title: bookingType === 'REQUEST' ? 'New booking request' : 'New booking',
        body: `A booking was ${bookingType === 'REQUEST' ? 'requested' : 'made'} for ${asset.name} on ${dto.date.toDateString()}.`,
        data: { bookingId: booking.id },
      })
    }

    return booking
  }

  async decideRequest(ownerUserId: string, bookingId: string, decision: 'APPROVED' | 'DECLINED', reason?: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { asset: { include: { assetOwner: true } } } })
    if (!booking) throw new NotFoundException('Booking not found.')
    if (booking.asset.assetOwner.userId !== ownerUserId) throw new ForbiddenException('You do not own this asset.')
    if (booking.status !== 'REQUESTED') throw new ConflictException('This booking is not awaiting a decision.')

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: decision } })
      await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: 'REQUESTED', toStatus: decision, changedBy: ownerUserId, reason } })

      if (decision === 'DECLINED') {
        await tx.assetAvailability.updateMany({ where: { assetId: booking.assetId, date: booking.date, slot: booking.slot }, data: { status: 'AVAILABLE' } })
      }

      await this.notifications.notify(
        {
          recipientId: booking.userId,
          senderId: ownerUserId,
          type: 'booking.decided',
          title: `Your booking was ${decision.toLowerCase()}`,
          body: decision === 'APPROVED' ? 'Please proceed to payment to confirm.' : (reason ?? 'The owner declined this request.'),
          data: { bookingId },
        },
        tx,
      )

      return updated
    })
  }

  /**
   * Dev-only stand-in for the real gateway verification M4 will add (same
   * gap as OTP/email delivery since M0) — flips a booking straight to
   * CONFIRMED without an actual payment. Never acceptable in production.
   */
  async confirmPayment(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { asset: { include: { assetOwner: true } } } })
    if (!booking) throw new NotFoundException('Booking not found.')
    if (booking.userId !== userId) throw new ForbiddenException('This is not your booking.')

    const currentStatus = await this.expireIfStale(booking)
    const expectedStatus = booking.bookingType === 'INSTANT' ? 'REQUESTED' : 'APPROVED'
    if (currentStatus !== expectedStatus) {
      throw new ConflictException(`This booking is not awaiting payment (status: ${currentStatus}).`)
    }

    const qrToken = this.generateQrToken(bookingId)

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: 'CONFIRMED', qrTokenHash: this.hashForAudit(qrToken) } })
      await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: expectedStatus, toStatus: 'CONFIRMED', changedBy: userId } })
      await this.notifications.notify(
        {
          recipientId: booking.asset.assetOwner.userId,
          senderId: userId,
          type: 'booking.confirmed',
          title: 'Booking confirmed',
          body: `Payment received for a booking on ${booking.date.toDateString()}.`,
          data: { bookingId },
        },
        tx,
      )
      return { ...updated, qrToken }
    })
  }

  async cancelBooking(userId: string, bookingId: string, reason?: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { asset: true } })
    if (!booking) throw new NotFoundException('Booking not found.')
    if (booking.userId !== userId) throw new ForbiddenException('This is not your booking.')
    if (!['REQUESTED', 'APPROVED', 'CONFIRMED'].includes(booking.status)) {
      throw new ConflictException('This booking cannot be cancelled from its current status.')
    }

    // Refund math per docs/11 §5 for display/audit — actual refund execution is M4 (no payment ledger exists yet),
    // so the slot is released immediately rather than held for "refund completion" as the fuller flow will do.
    let refundAmount = 0
    if (booking.status === 'CONFIRMED') {
      const daysUntil = Math.ceil((booking.date.getTime() - Date.now()) / 86_400_000)
      const gross =
        daysUntil >= booking.asset.cancellationDeadlineDays
          ? Number(booking.totalAmount)
          : (Number(booking.totalAmount) * booking.asset.cancellationRefundPercent) / 100
      refundAmount = Math.max(0, Math.round((gross - Number(booking.asset.flatCancellationCharge)) * 100) / 100)
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } })
      await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: booking.status, toStatus: 'CANCELLED', changedBy: userId, reason } })
      await tx.assetAvailability.updateMany({ where: { assetId: booking.assetId, date: booking.date, slot: booking.slot }, data: { status: 'AVAILABLE' } })
      return { ...updated, refundAmount }
    })
  }

  async completeBooking(actorUserId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { asset: { include: { assetOwner: true } } } })
    if (!booking) throw new NotFoundException('Booking not found.')
    await this.assertOwnerOrAdmin(actorUserId, booking.asset.assetOwner.userId)
    if (booking.status !== 'CONFIRMED') throw new ConflictException('Only a confirmed booking can be marked complete.')

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({ where: { id: bookingId }, data: { status: 'COMPLETED' } })
      await tx.bookingStatusHistory.create({ data: { bookingId, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', changedBy: actorUserId } })
      return updated
    })
  }

  async myBookings(userId: string) {
    return this.prisma.booking.findMany({ where: { userId }, include: { asset: true, review: true }, orderBy: { createdAt: 'desc' } })
  }

  async ownerBookings(ownerUserId: string) {
    const owner = await this.prisma.assetOwner.findUnique({ where: { userId: ownerUserId } })
    if (!owner) return []
    return this.prisma.booking.findMany({
      where: { asset: { assetOwnerId: owner.id } },
      include: { asset: true, user: { include: { member: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getById(actorUserId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { asset: { include: { assetOwner: true } }, items: true, guests: true, statusHistory: { orderBy: { createdAt: 'asc' } } },
    })
    if (!booking) throw new NotFoundException('Booking not found.')
    const isSelf = booking.userId === actorUserId
    const isOwner = booking.asset.assetOwner.userId === actorUserId
    if (!isSelf && !isOwner) {
      const isAdmin = await this.prisma.userRole.count({ where: { userId: actorUserId, role: { code: 'ADMIN' } } })
      if (!isAdmin) throw new ForbiddenException('You do not have access to this booking.')
    }
    const currentStatus = await this.expireIfStale(booking)
    return currentStatus === booking.status ? booking : { ...booking, status: currentStatus }
  }

  async getQrToken(userId: string, bookingId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } })
    if (!booking) throw new NotFoundException('Booking not found.')
    if (booking.userId !== userId) throw new ForbiddenException('This is not your booking.')
    if (booking.status !== 'CONFIRMED') throw new ConflictException('Only a confirmed booking has a check-in QR code.')
    return { token: this.generateQrToken(bookingId) }
  }

  async verifyQr(staffUserId: string, token: string) {
    const bookingId = this.verifyQrToken(token)
    if (!bookingId) throw new BadRequestException('Invalid QR code.')

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { asset: { include: { assetOwner: true } }, guests: true },
    })
    if (!booking) throw new NotFoundException('Booking not found.')
    await this.assertOwnerOrAdmin(staffUserId, booking.asset.assetOwner.userId)
    if (booking.status !== 'CONFIRMED') throw new ConflictException(`Booking status is ${booking.status}, not CONFIRMED.`)

    return {
      bookingId: booking.id,
      assetName: booking.asset.name,
      date: booking.date,
      slot: booking.slot,
      status: booking.status,
      guests: booking.guests.map((g) => g.name),
    }
  }

  private async assertOwnerOrAdmin(actorUserId: string, ownerUserId: string): Promise<void> {
    if (actorUserId === ownerUserId) return
    const isAdmin = await this.prisma.userRole.count({ where: { userId: actorUserId, role: { code: 'ADMIN' } } })
    if (!isAdmin) throw new ForbiddenException('Only the asset owner or an Admin can perform this action.')
  }

  /**
   * There is no background scheduler in this project yet, so EXPIRED is
   * reached lazily — checked whenever a booking is read or paid for, rather
   * than proactively swept. A REQUESTED/APPROVED booking older than the
   * payment window transitions here and its slot is released immediately.
   */
  private async expireIfStale(booking: { id: string; status: string; createdAt: Date; assetId: string; date: Date; slot: string }): Promise<string> {
    const hoursSinceCreated = (Date.now() - booking.createdAt.getTime()) / 3_600_000
    if ((booking.status === 'REQUESTED' || booking.status === 'APPROVED') && hoursSinceCreated > PAYMENT_WINDOW_HOURS) {
      await this.prisma.$transaction(async (tx) => {
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } })
        await tx.bookingStatusHistory.create({ data: { bookingId: booking.id, fromStatus: booking.status, toStatus: 'EXPIRED' } })
        await tx.assetAvailability.updateMany({ where: { assetId: booking.assetId, date: booking.date, slot: booking.slot }, data: { status: 'AVAILABLE' } })
      })
      return 'EXPIRED'
    }
    return booking.status
  }

  private generateQrToken(bookingId: string): string {
    return `${bookingId}.${this.signBookingId(bookingId)}`
  }

  private verifyQrToken(token: string): string | null {
    const [bookingId, signature] = token.split('.')
    if (!bookingId || !signature) return null
    return signature === this.signBookingId(bookingId) ? bookingId : null
  }

  private signBookingId(bookingId: string): string {
    return createHmac('sha256', this.qrSecret).update(bookingId).digest('hex').slice(0, 24)
  }

  private hashForAudit(token: string): string {
    return createHmac('sha256', this.qrSecret).update(token).digest('hex')
  }
}
