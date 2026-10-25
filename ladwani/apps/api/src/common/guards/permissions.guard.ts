import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Permission } from '@community-platform/shared-types'
import { PrismaService } from '../../prisma/prisma.service'
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator'

/**
 * Resolves "does this role have this permission at all" only. Record-scoped
 * checks ("is this user the Karta of THIS family") are explicit per-module
 * policy calls — see docs/17-auth-design.md §2.2. This guard is intentionally
 * generic and does not know about family/asset/booking ownership.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest()
    const user = request.user
    if (!user?.sub) throw new ForbiddenException('Not authenticated')

    const granted = await this.permissionsForUser(user.sub)
    const allowed = required.every((p) => granted.has(p))
    if (!allowed) throw new ForbiddenException('Insufficient permissions')
    return true
  }

  private async permissionsForUser(userId: string): Promise<Set<string>> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    })
    const permissions = new Set<string>()
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) {
        permissions.add(rp.permission.code)
      }
    }
    return permissions
  }
}
