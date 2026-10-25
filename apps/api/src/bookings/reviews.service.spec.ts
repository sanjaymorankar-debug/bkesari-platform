import { Test } from '@nestjs/testing'
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { ReviewsService } from './reviews.service'
import { PrismaService } from '../prisma/prisma.service'

describe('ReviewsService — review-gate enforcement (docs/11 §7)', () => {
  let service: ReviewsService
  let prisma: { booking: { findUnique: jest.Mock }; review: { findUnique: jest.Mock; create: jest.Mock } }

  beforeEach(async () => {
    prisma = { booking: { findUnique: jest.fn() }, review: { findUnique: jest.fn(), create: jest.fn() } }
    const moduleRef = await Test.createTestingModule({
      providers: [ReviewsService, { provide: PrismaService, useValue: prisma }],
    }).compile()
    service = moduleRef.get(ReviewsService)
  })

  it('404s when the booking does not exist', async () => {
    prisma.booking.findUnique.mockResolvedValue(null)
    await expect(service.createReview('user-1', { bookingId: 'missing', overallScore: 5 } as never)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('refuses a review from anyone other than the booking owner, even for a completed booking', async () => {
    prisma.booking.findUnique.mockResolvedValue({ id: 'b1', userId: 'renter-1', status: 'COMPLETED', assetId: 'asset-1' })
    await expect(service.createReview('someone-else', { bookingId: 'b1', overallScore: 5 } as never)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('refuses a review for a booking that was cancelled, not completed', async () => {
    prisma.booking.findUnique.mockResolvedValue({ id: 'b1', userId: 'renter-1', status: 'CANCELLED', assetId: 'asset-1' })
    await expect(service.createReview('renter-1', { bookingId: 'b1', overallScore: 5 } as never)).rejects.toBeInstanceOf(ConflictException)
  })

  it('refuses a review for a booking that never happened (still REQUESTED/CONFIRMED)', async () => {
    prisma.booking.findUnique.mockResolvedValue({ id: 'b1', userId: 'renter-1', status: 'CONFIRMED', assetId: 'asset-1' })
    await expect(service.createReview('renter-1', { bookingId: 'b1', overallScore: 5 } as never)).rejects.toBeInstanceOf(ConflictException)
  })

  it('refuses a second review for the same booking', async () => {
    prisma.booking.findUnique.mockResolvedValue({ id: 'b1', userId: 'renter-1', status: 'COMPLETED', assetId: 'asset-1' })
    prisma.review.findUnique.mockResolvedValue({ id: 'existing-review' })
    await expect(service.createReview('renter-1', { bookingId: 'b1', overallScore: 5 } as never)).rejects.toBeInstanceOf(ConflictException)
    expect(prisma.review.create).not.toHaveBeenCalled()
  })

  it('allows exactly the booking owner to review their own completed booking', async () => {
    prisma.booking.findUnique.mockResolvedValue({ id: 'b1', userId: 'renter-1', status: 'COMPLETED', assetId: 'asset-1' })
    prisma.review.findUnique.mockResolvedValue(null)
    prisma.review.create.mockResolvedValue({ id: 'review-1' })

    const result = await service.createReview('renter-1', { bookingId: 'b1', overallScore: 4, comment: 'Great venue' } as never)

    expect(prisma.review.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bookingId: 'b1', assetId: 'asset-1', reviewerId: 'renter-1', overallScore: 4 }) }),
    )
    expect(result).toEqual({ id: 'review-1' })
  })
})
