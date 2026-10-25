import { IsIn, IsOptional, IsString } from 'class-validator'
import { MATRIMONY_INTEREST_KINDS, type MatrimonyInterestKind } from '@community-platform/shared-types'

export class SendInterestDto {
  @IsString()
  toMemberId!: string

  @IsIn(MATRIMONY_INTEREST_KINDS)
  kind!: MatrimonyInterestKind

  @IsOptional()
  @IsString()
  message?: string
}
