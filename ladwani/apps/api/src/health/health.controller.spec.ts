import { ServiceUnavailableException } from '@nestjs/common'
import { HealthController } from './health.controller'

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) }
    await expect(new HealthController(prisma).check()).resolves.toEqual({ data: { status: 'ok', database: 'ok' } })
  })

  it('answers 503 when the database does not', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) }
    await expect(new HealthController(prisma).check()).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
