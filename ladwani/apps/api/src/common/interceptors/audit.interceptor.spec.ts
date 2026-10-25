import { of } from 'rxjs'
import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { AuditInterceptor } from './audit.interceptor'

describe('AuditInterceptor', () => {
  let prisma: { auditLog: { create: jest.Mock } }
  let interceptor: AuditInterceptor
  let reflector: { getAllAndOverride: jest.Mock }

  function contextWith(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext
  }

  function handlerReturning(value: unknown): CallHandler {
    return { handle: () => of(value) }
  }

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } }
    reflector = { getAllAndOverride: jest.fn() }
    interceptor = new AuditInterceptor(reflector as never, prisma as never)
  })

  it('skips logging entirely when the handler carries no @Audited action', (done) => {
    reflector.getAllAndOverride.mockReturnValue(undefined)
    interceptor.intercept(contextWith({}), handlerReturning({ id: 'x' })).subscribe(() => {
      expect(prisma.auditLog.create).not.toHaveBeenCalled()
      done()
    })
  })

  it('derives entityType from the action code prefix before the first dot', (done) => {
    reflector.getAllAndOverride.mockReturnValue('config.post_type.create')
    interceptor.intercept(contextWith({ user: { sub: 'u1' }, ip: '1.2.3.4' }), handlerReturning({ id: 'pt-1' })).subscribe(() => {
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entityType: 'config', action: 'config.post_type.create' }) }),
      )
      done()
    })
  })

  it('reads entityId from a bare id, a nested { data: { id } } wrapper, or falls back to the route param', (done) => {
    reflector.getAllAndOverride.mockReturnValue('payment.verify')
    interceptor.intercept(contextWith({ params: { id: 'route-id' } }), handlerReturning({ data: { id: 'nested-id' } })).subscribe(() => {
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityId: 'nested-id' }) }))
      done()
    })
  })

  it('falls back to the route param id when the result carries none', (done) => {
    reflector.getAllAndOverride.mockReturnValue('payment.verify')
    interceptor.intercept(contextWith({ params: { id: 'route-id' } }), handlerReturning(undefined)).subscribe(() => {
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityId: 'route-id' }) }))
      done()
    })
  })

  it('never lets a logging failure surface to the caller', (done) => {
    reflector.getAllAndOverride.mockReturnValue('config.area.create')
    prisma.auditLog.create.mockRejectedValue(new Error('db down'))
    interceptor.intercept(contextWith({}), handlerReturning({ id: 'a1' })).subscribe((value) => {
      expect(value).toEqual({ id: 'a1' })
      done()
    })
  })

  it('records "system" as the actor when the request carries no authenticated user (e.g. a webhook)', (done) => {
    reflector.getAllAndOverride.mockReturnValue('payment.webhook.received')
    interceptor.intercept(contextWith({}), handlerReturning({})).subscribe(() => {
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'system', actorRole: null }) }))
      done()
    })
  })
})
