import { SetMetadata } from '@nestjs/common'
import type { Permission } from '@community-platform/shared-types'

export const PERMISSIONS_KEY = 'permissions'
export const Permissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions)
