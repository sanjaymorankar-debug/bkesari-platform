import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * GET /api/v1/health: 200 when the API is up and its database answers, 503
 * when the database does not. Public, and touches no tables, so a deploy's
 * smoke check (or an uptime monitor) can tell "the API runs" apart from "the
 * API runs but cannot reach Neon".
 */
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch {
      throw new ServiceUnavailableException('Database unreachable')
    }
    return { data: { status: 'ok', database: 'ok' } }
  }
}
