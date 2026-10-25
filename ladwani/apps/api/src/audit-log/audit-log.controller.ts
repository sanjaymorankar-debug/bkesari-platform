import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { AuditLogService } from './audit-log.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('audit:view')
export class AuditLogController {
  constructor(private auditLog: AuditLogService) {}

  @Get()
  async list(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    const { rows, total } = await this.auditLog.list({
      actorId,
      action,
      entityType,
      from,
      to,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    })
    return { data: rows, total }
  }
}
