import { Controller, Get, UseGuards } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('relationship-types')
@UseGuards(JwtAuthGuard)
export class LookupsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async list() {
    const types = await this.prisma.relationshipType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, label: true, genderApplicable: true, isSpouse: true },
    })
    return { data: types }
  }
}
