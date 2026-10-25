import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type { ReactionType } from '@community-platform/shared-types'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { CreatePostDto } from './dto/create-post.dto'
import { CreateCommentDto } from './dto/create-comment.dto'

export interface ReactionTarget {
  postId?: string
  commentId?: string
}

export interface ReportTarget {
  postId?: string
  commentId?: string
  memberId?: string
}

@Injectable()
export class CommunityService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async createPost(authorUserId: string, dto: CreatePostDto) {
    const member = await this.mustGetMember(authorUserId)
    const postType = await this.prisma.postType.findUnique({ where: { code: dto.postTypeCode } })
    if (!postType || !postType.isActive) throw new NotFoundException('Unknown post type.')

    return this.prisma.post.create({
      data: {
        authorId: member.id,
        postTypeId: postType.id,
        title: dto.title,
        content: dto.content,
        targetAreaId: dto.targetAreaId,
        status: postType.requiresApproval ? 'PENDING_APPROVAL' : 'PUBLISHED',
      },
    })
  }

  /** Area-scoped feed: a post with no target area is community-wide; otherwise the viewer must share that area. */
  async getFeed(viewerAreaIds: string[], filters: { postTypeCode?: string } = {}) {
    return this.prisma.post.findMany({
      where: {
        deletedAt: null,
        status: 'PUBLISHED',
        OR: [{ targetAreaId: null }, { targetAreaId: { in: viewerAreaIds } }],
        ...(filters.postTypeCode ? { postType: { code: filters.postTypeCode } } : {}),
      },
      include: { author: true, postType: true, _count: { select: { comments: true, reactions: true } } },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: 30,
    })
  }

  async getPost(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        author: true,
        postType: true,
        comments: { where: { deletedAt: null }, include: { author: true }, orderBy: { createdAt: 'asc' } },
        _count: { select: { reactions: true } },
      },
    })
    if (!post || post.deletedAt || post.status !== 'PUBLISHED') throw new NotFoundException('Post not found.')
    return post
  }

  async addComment(authorUserId: string, postId: string, dto: CreateCommentDto) {
    const member = await this.mustGetMember(authorUserId)
    const post = await this.prisma.post.findUnique({ where: { id: postId }, include: { author: true } })
    if (!post || post.deletedAt || post.status !== 'PUBLISHED') throw new NotFoundException('Post not found.')

    const comment = await this.prisma.comment.create({
      data: { postId, authorId: member.id, parentId: dto.parentId, content: dto.content },
    })

    if (post.authorId !== member.id && post.author.userId) {
      await this.notifications.notify({
        recipientId: post.author.userId,
        senderId: authorUserId,
        type: 'community.comment.received',
        title: 'New comment on your post',
        body: `${member.firstName} commented on your post.`,
        data: { postId, commentId: comment.id },
      })
    }

    return comment
  }

  async react(actorUserId: string, target: ReactionTarget, type: ReactionType = 'LIKE') {
    const member = await this.mustGetMember(actorUserId)
    if (target.postId) {
      return this.prisma.reaction.upsert({
        where: { postId_memberId: { postId: target.postId, memberId: member.id } },
        update: { type },
        create: { postId: target.postId, memberId: member.id, type },
      })
    }
    if (target.commentId) {
      return this.prisma.reaction.upsert({
        where: { commentId_memberId: { commentId: target.commentId, memberId: member.id } },
        update: { type },
        create: { commentId: target.commentId, memberId: member.id, type },
      })
    }
    throw new BadRequestException('A reaction must target a post or comment.')
  }

  async removeReaction(actorUserId: string, target: ReactionTarget) {
    const member = await this.mustGetMember(actorUserId)
    if (target.postId) await this.prisma.reaction.deleteMany({ where: { postId: target.postId, memberId: member.id } })
    else if (target.commentId) await this.prisma.reaction.deleteMany({ where: { commentId: target.commentId, memberId: member.id } })
    else throw new BadRequestException('A reaction must target a post or comment.')
    return { removed: true }
  }

  async createReport(reporterUserId: string, target: ReportTarget, reason: string) {
    const reporter = await this.mustGetMember(reporterUserId)
    if (!target.postId && !target.commentId && !target.memberId) {
      throw new BadRequestException('A report must target a post, comment, or member.')
    }
    return this.prisma.report.create({
      data: { postId: target.postId, commentId: target.commentId, memberId: target.memberId, reporterId: reporter.id, reason },
    })
  }

  async listModerationQueue() {
    const [pendingPosts, pendingReports] = await Promise.all([
      this.prisma.post.findMany({ where: { status: 'PENDING_APPROVAL' }, include: { author: true, postType: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.report.findMany({
        where: { status: 'PENDING' },
        include: { post: true, comment: true, reportedMember: true, reporter: true },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return { pendingPosts, pendingReports }
  }

  async moderatePost(operatorUserId: string, postId: string, decision: 'APPROVED' | 'REJECTED', note?: string) {
    const post = await this.prisma.post.findUnique({ where: { id: postId }, include: { author: true } })
    if (!post) throw new NotFoundException('Post not found.')
    if (post.status !== 'PENDING_APPROVAL') throw new ConflictException('This post is not pending approval.')

    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: { status: decision === 'APPROVED' ? 'PUBLISHED' : 'REJECTED' },
    })

    if (post.author.userId) {
      await this.notifications.notify({
        recipientId: post.author.userId,
        senderId: operatorUserId,
        type: 'community.post.moderated',
        title: `Your post was ${decision.toLowerCase()}`,
        body: note ?? '',
        data: { postId },
      })
    }

    return updated
  }

  async resolveReport(operatorUserId: string, reportId: string, decision: 'DISMISSED' | 'ACTIONED') {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } })
    if (!report) throw new NotFoundException('Report not found.')
    if (report.status !== 'PENDING') throw new ConflictException('This report has already been resolved.')

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({ where: { id: reportId }, data: { status: decision, resolvedBy: operatorUserId, resolvedAt: new Date() } })
      if (decision === 'ACTIONED') {
        if (report.postId) await tx.post.update({ where: { id: report.postId }, data: { status: 'REMOVED' } })
        if (report.commentId) await tx.comment.update({ where: { id: report.commentId }, data: { deletedAt: new Date() } })
      }
      return updated
    })
  }

  private async mustGetMember(userId: string) {
    const member = await this.prisma.member.findUnique({ where: { userId } })
    if (!member) throw new NotFoundException('Complete registration before using community features.')
    return member
  }
}
