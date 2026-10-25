import { Test } from '@nestjs/testing'
import { AuditLogService } from './audit-log.service'
import { PrismaService } from '../prisma/prisma.service'

describe('AuditLogService', () => {
  let service: AuditLogService
  let prisma: { auditLog: { findMany: jest.Mock; count: jest.Mock } }

  beforeEach(async () => {
    prisma = { auditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) } }
    const moduleRef = await Test.createTestingModule({
      providers: [AuditLogService, { provide: PrismaService, useValue: prisma }],
    }).compile()
    service = moduleRef.get(AuditLogService)
  })

  it('filters by actor, action substring, entity type, and date range', async () => {
    await service.list({ actorId: 'user-1', action: 'family', entityType: 'family', from: '2026-01-01', to: '2026-02-01' })

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          actorId: 'user-1',
          entityType: 'family',
          action: { contains: 'family', mode: 'insensitive' },
          createdAt: { gte: new Date('2026-01-01'), lte: new Date('2026-02-01') },
        },
      }),
    )
  })

  it('caps the page size at 200 regardless of what is requested', async () => {
    await service.list({ take: 10_000 })
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))
  })

  it('defaults to a 50-row page with no filters applied', async () => {
    await service.list({})
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50, skip: 0, where: { actorId: undefined, entityType: undefined, action: undefined, createdAt: undefined } }),
    )
  })
})
