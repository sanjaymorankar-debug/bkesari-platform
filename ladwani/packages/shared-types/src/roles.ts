export const ROLE_CODES = ['MEMBER', 'KARTA', 'OPERATOR', 'ASSET_OWNER', 'ADMIN'] as const
export type RoleCode = (typeof ROLE_CODES)[number]

/**
 * Permission strings are `resource:action` or `resource:action:scope`.
 * The scope qualifier (:own, :any, :family) is checked against the actual
 * record at request time by the owning module, not by the permission guard
 * alone — see docs/17-auth-design.md §2.2.
 */
export const PERMISSIONS = [
  'profile:edit:own',
  'profile:edit:any',
  'family:create',
  'family:edit:own',
  'family:join',
  'family:member:add',
  'family:member:remove',
  'family:karta:transfer',
  'member:marital_status:edit',
  'member:mark_deceased',
  'approval:review',
  'matrimony:manage:own',
  'matrimony:manage:family',
  'post:create',
  'moderation:review',
  'asset:register',
  'asset:approve',
  'asset:manage:own',
  'booking:create',
  'booking:manage:own',
  'fee:configure',
  'fee:pay:family',
  'payment:verify:offline',
  'refund:approve',
  'role:manage',
  'audit:view',
  'config:manage',
  'report:view',
] as const
export type Permission = (typeof PERMISSIONS)[number]

/** Default role -> permission bundles, seeded on first migration. Admin can edit later. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  MEMBER: [
    'profile:edit:own',
    'family:create',
    'family:join',
    'member:marital_status:edit',
    'matrimony:manage:own',
    'post:create',
    'booking:create',
  ],
  KARTA: [
    'profile:edit:own',
    'family:create',
    'family:join',
    'family:edit:own',
    'family:member:add',
    'family:member:remove',
    'family:karta:transfer',
    'member:marital_status:edit',
    'member:mark_deceased',
    'matrimony:manage:own',
    'matrimony:manage:family',
    'post:create',
    'booking:create',
    'fee:pay:family',
  ],
  OPERATOR: [
    'profile:edit:own',
    'family:member:add',
    'family:edit:own',
    'member:mark_deceased',
    'approval:review',
    'moderation:review',
    'matrimony:manage:own',
    'asset:approve',
    'payment:verify:offline',
    'post:create',
    'booking:create',
    'audit:view',
    'report:view',
  ],
  ASSET_OWNER: [
    'profile:edit:own',
    'matrimony:manage:own',
    'asset:register',
    'asset:manage:own',
    'booking:manage:own',
    'post:create',
    'booking:create',
    'audit:view',
  ],
  ADMIN: [...PERMISSIONS],
}
