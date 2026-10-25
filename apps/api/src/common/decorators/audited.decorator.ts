import { SetMetadata } from '@nestjs/common'

export const AUDIT_ACTION_KEY = 'auditAction'
/** Tags a handler so AuditInterceptor writes an audit_logs row on success. See docs/12-approval-workflow.md §6. */
export const Audited = (action: string) => SetMetadata(AUDIT_ACTION_KEY, action)
