import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateReviewDto } from './dto/create-review.dto'

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  /** Gated on booking.status = COMPLETED and booking.userId = reviewer — docs/11 §7 — checked here, not assumed from the UI. */
  async createReview(userId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } })
    if (!booking) throw new NotFoundException('Booking not found.')
    if (booking.userId !== userId) throw new ForbiddenException('You can only review your own booking.')
    if (booking.status !== 'COMPLETED') throw new ConflictException('You can only review a completed booking.')

    const existing = await this.prisma.review.findUnique({ where: { bookingId: dto.bookingId } })
    if (existing) throw new ConflictException('This booking has already been reviewed.')

    return this.prisma.review.create({
      data: {
        bookingId: dto.bookingId,
        assetId: booking.assetId,
        reviewerId: userId,
        overallScore: dto.overallScore,
        cleanlinessScore: dto.cleanlinessScore,
        facilitiesScore: dto.facilitiesScore,
        serviceScore: dto.serviceScore,
        valueScore: dto.valueScore,
        locationScore: dto.locationScore,
        comment: dto.comment,
      },
    })
  }

  async listForAsset(assetId: string) {
    return this.prisma.review.findMany({ where: { assetId }, orderBy: { createdAt: 'desc' } })
  }
}
