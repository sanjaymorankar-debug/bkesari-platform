import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator'

export class UpdateAssetCategoryDto {
  @IsOptional()
  @IsString()
  label?: string

  @IsOptional()
  @IsInt()
  sortOrder?: number

  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}
