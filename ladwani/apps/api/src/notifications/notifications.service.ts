import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

type Db = PrismaService | Prisma.TransactionClient

export interface NotifyInput {
  recipientId: string
  senderId?: string
  type: string
  title: string
  body: string
  data?: unknown
}

/**
 * In-app notification feed. Email/SMS delivery is not wired to any provider
 * yet (same gap as OTP delivery in M0's AuthService) — emailSent stays
 * false; the row is still created so the in-app feed and future delivery
 * wiring share one source of truth.
 */
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async notify(input: NotifyInput, db: Db = this.prisma) {
    return db.notification.create({
      data: {
        recipientId: input.recipientId,
        senderId: input.senderId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data as never,
      },
    })
  }

  async list(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { recipientId: userId, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  async markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({ where: { id, recipientId: userId }, data: { isRead: true } })
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({ where: { recipientId: userId, isRead: false }, data: { isRead: true } })
  }
}
