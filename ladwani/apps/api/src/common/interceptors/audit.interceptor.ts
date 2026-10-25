import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, tap } from 'rxjs'
import { PrismaService } from '../../prisma/prisma.service'
import { AUDIT_ACTION_KEY } from '../decorators/audited.decorator'

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!action) return next.handle()

    const request = context.switchToHttp().getRequest()
    const user = request.user

    return next.handle().pipe(
      tap((result) => {
        // Audit logging must never fail the request it's observing.
        this.prisma.auditLog
          .create({
            data: {
              actorId: user?.sub ?? 'system',
              actorRole: user?.roles?.[0] ?? null,
              action,
              entityType: action.split('.')[0] ?? null,
              entityId:
                (result as { id?: string })?.id ??
                (result as { data?: { id?: string } })?.data?.id ??
                request.params?.id ??
                null,
              newValue: request.body ?? undefined,
              ipAddress: request.ip,
            },
          })
          .catch(() => undefined)
      }),
    )
  }
}
