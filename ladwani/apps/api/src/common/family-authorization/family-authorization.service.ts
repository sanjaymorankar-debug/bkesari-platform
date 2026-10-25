import { ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * Record-scoped "is this user the Karta of THIS family" check. Deliberately
 * separate from the generic PermissionsGuard, which only knows "does this
 * role have this permission at all" (docs/17-auth-design.md §2.2).
 */
@Injectable()
export class FamilyAuthorizationService {
  constructor(private prisma: PrismaService) {}

  async isKartaOf(userId: string, familyId: string): Promise<boolean> {
    const count = await this.prisma.userRole.count({ where: { userId, familyId, role: { code: 'KARTA' } } })
    return count > 0
  }

  async assertIsKarta(userId: string, familyId: string): Promise<void> {
    if (!(await this.isKartaOf(userId, familyId))) {
      throw new ForbiddenException("Only this family's Karta can perform this action.")
    }
  }
}
