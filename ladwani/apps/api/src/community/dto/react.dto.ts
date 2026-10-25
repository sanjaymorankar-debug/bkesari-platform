import { IsIn, IsOptional } from 'class-validator'
import { REACTION_TYPES, type ReactionType } from '@community-platform/shared-types'

export class ReactDto {
  @IsOptional()
  @IsIn(REACTION_TYPES)
  type?: ReactionType
}
