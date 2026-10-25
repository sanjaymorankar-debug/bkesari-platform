import { Type } from 'class-transformer'
import { IsDate, IsIn, IsNumber, IsOptional, Min } from 'class-validator'
import { ASSET_PRICE_TYPES, type AssetPriceType } from '@community-platform/shared-types'

export class AddPricingDto {
  @IsIn(ASSET_PRICE_TYPES)
  priceType!: AssetPriceType

  @IsNumber()
  @Min(0)
  amount!: number

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validFrom?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validTo?: Date
}
