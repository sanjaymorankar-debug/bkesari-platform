import { Test } from '@nestjs/testing'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { CommunityService } from './community.service'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

describe('CommunityService', () => {
  let service: CommunityService
  let prisma: {
    post: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock; create: jest.Mock }
    report: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
    member: { findUnique: jest.Mock }
    comment: { update: jest.Mock }
    $transaction: jest.Mock
  }
  let notifications: { notify: jest.Mock }

  beforeEach(async () => {
    prisma = {
      post: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
      report: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      member: { findUnique: jest.fn() },
      comment: { update: jest.fn() },
      $transaction: jest.fn(),
    }
    notifications = { notify: jest.fn() }

    const moduleRef = await Test.createTestingModule({
      providers: [CommunityService, { provide: PrismaService, useValue: prisma }, { provide: NotificationsService, useValue: notifications }],
    }).compile()

    service = moduleRef.get(CommunityService)
  })

  describe('feed scope filters', () => {
    it("only queries posts that are community-wide or in the viewer's own areas", async () => {
      prisma.post.findMany.mockResolvedValue([])

      await service.getFeed(['area-pune', 'area-mumbai'])

      expect(prisma.post.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'PUBLISHED',
            OR: [{ targetAreaId: null }, { targetAreaId: { in: ['area-pune', 'area-mumbai'] } }],
          }),
        }),
      )
    })

    it('excludes soft-deleted and non-published posts regardless of area', async () => {
      prisma.post.findMany.mockResolvedValue([])

      await service.getFeed([])

      const callArgs = prisma.post.findMany.mock.calls[0][0]
      expect(callArgs.where.deletedAt).toBeNull()
      expect(callArgs.where.status).toBe('PUBLISHED')
      expect(callArgs.where.OR).toEqual([{ targetAreaId: null }, { targetAreaId: { in: [] } }])
    })

    it('filters by post type when provided, without dropping the area scope', async () => {
      prisma.post.findMany.mockResolvedValue([])

      await service.getFeed(['area-pune'], { postTypeCode: 'ANNOUNCEMENT' })

      const callArgs = prisma.post.findMany.mock.calls[0][0]
      expect(callArgs.where.postType).toEqual({ code: 'ANNOUNCEMENT' })
      expect(callArgs.where.OR).toEqual([{ targetAreaId: null }, { targetAreaId: { in: ['area-pune'] } }])
    })
  })

  describe('moderation queue', () => {
    it('returns pending posts and pending reports together', async () => {
      prisma.post.findMany.mockResolvedValue([{ id: 'post-1', status: 'PENDING_APPROVAL' }])
      prisma.report.findMany.mockResolvedValue([{ id: 'report-1', status: 'PENDING' }])

      const result = await service.listModerationQueue()

      expect(prisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING_APPROVAL' } }))
      expect(prisma.report.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING' } }))
      expect(result.pendingPosts).toHaveLength(1)
      expect(result.pendingReports).toHaveLength(1)
    })

    it('refuses to moderate a post that is not pending approval', async () => {
      prisma.post.findUnique.mockResolvedValue({ id: 'post-1', status: 'PUBLISHED', author: { userId: 'author-user' } })

      await expect(service.moderatePost('operator-1', 'post-1', 'APPROVED')).rejects.toBeInstanceOf(ConflictException)
      expect(prisma.post.update).not.toHaveBeenCalled()
    })

    it('publishes an approved pending post and notifies the author', async () => {
      prisma.post.findUnique.mockResolvedValue({ id: 'post-1', status: 'PENDING_APPROVAL', author: { userId: 'author-user' } })
      prisma.post.update.mockResolvedValue({ id: 'post-1', status: 'PUBLISHED' })

      await service.moderatePost('operator-1', 'post-1', 'APPROVED')

      expect(prisma.post.update).toHaveBeenCalledWith({ where: { id: 'post-1' }, data: { status: 'PUBLISHED' } })
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ recipientId: 'author-user', type: 'community.post.moderated' }))
    })

    it('404s moderating a post that does not exist', async () => {
      prisma.post.findUnique.mockResolvedValue(null)
      await expect(service.moderatePost('operator-1', 'missing', 'APPROVED')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('refuses to resolve a report that has already been resolved', async () => {
      prisma.report.findUnique.mockResolvedValue({ id: 'report-1', status: 'DISMISSED' })
      await expect(service.resolveReport('operator-1', 'report-1', 'ACTIONED')).rejects.toBeInstanceOf(ConflictException)
    })

    it('removes the reported post when a report is actioned', async () => {
      prisma.report.findUnique.mockResolvedValue({ id: 'report-1', status: 'PENDING', postId: 'post-1', commentId: null })
      const tx = { report: { update: jest.fn().mockResolvedValue({ id: 'report-1', status: 'ACTIONED' }) }, post: { update: jest.fn() }, comment: { update: jest.fn() } }
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await service.resolveReport('operator-1', 'report-1', 'ACTIONED')

      expect(tx.post.update).toHaveBeenCalledWith({ where: { id: 'post-1' }, data: { status: 'REMOVED' } })
      expect(tx.comment.update).not.toHaveBeenCalled()
    })

    it('leaves the reported content untouched when a report is dismissed', async () => {
      prisma.report.findUnique.mockResolvedValue({ id: 'report-1', status: 'PENDING', postId: 'post-1', commentId: null })
      const tx = { report: { update: jest.fn().mockResolvedValue({ id: 'report-1', status: 'DISMISSED' }) }, post: { update: jest.fn() }, comment: { update: jest.fn() } }
      prisma.$transaction.mockImplementation(async (fn) => fn(tx))

      await service.resolveReport('operator-1', 'report-1', 'DISMISSED')

      expect(tx.post.update).not.toHaveBeenCalled()
    })
  })
})
