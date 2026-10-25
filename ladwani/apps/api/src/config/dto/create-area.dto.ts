import { IsIn, IsOptional, IsString } from 'class-validator'
import { AREA_TYPES, type AreaType } from '@community-platform/shared-types'

export class CreateAreaDto {
  @IsString()
  name!: string

  @IsIn(AREA_TYPES)
  type!: AreaType

  @IsOptional()
  @IsString()
  parentId?: string
}
