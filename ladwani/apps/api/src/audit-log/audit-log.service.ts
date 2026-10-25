import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

export interface AuditLogQuery {
  actorId?: string
  action?: string
  entityType?: string
  from?: string
  to?: string
  take?: number
  skip?: number
}

const MAX_PAGE_SIZE = 200

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  async list(query: AuditLogQuery) {
    const where: Prisma.AuditLogWhereInput = {
      actorId: query.actorId || undefined,
      entityType: query.entityType || undefined,
      action: query.action ? { contains: query.action, mode: 'insensitive' } : undefined,
      createdAt: query.from || query.to ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined } : undefined,
    }

    const take = Math.min(query.take ?? 50, MAX_PAGE_SIZE)
    const skip = query.skip ?? 0

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      this.prisma.auditLog.count({ where }),
    ])

    return { rows, total }
  }
}
