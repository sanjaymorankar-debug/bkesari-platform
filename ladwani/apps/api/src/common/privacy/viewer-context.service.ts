import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { VisibilityViewer } from './visibility'

/** Resolves the current request's VisibilityViewer context from their own memberships. */
@Injectable()
export class ViewerContextService {
  constructor(private prisma: PrismaService) {}

  async build(userId: string | undefined): Promise<VisibilityViewer> {
    if (!userId) return { isAuthenticated: false }

    const [userRoles, member] = await Promise.all([
      this.prisma.userRole.findMany({ where: { userId }, include: { role: true } }),
      this.prisma.member.findUnique({ where: { userId }, include: { families: true, memberAreas: true } }),
    ])

    return {
      isAuthenticated: true,
      userId,
      roles: userRoles.map((ur) => ur.role.code),
      familyIds: member?.families.filter((fm) => !fm.leftAt).map((fm) => fm.familyId) ?? [],
      areaIds: member?.memberAreas.map((ma) => ma.areaId) ?? [],
    }
  }
}
