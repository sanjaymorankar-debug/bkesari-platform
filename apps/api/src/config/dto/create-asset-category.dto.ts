import { IsInt, IsOptional, IsString } from 'class-validator'

export class CreateAssetCategoryDto {
  @IsString()
  code!: string

  @IsString()
  label!: string

  @IsOptional()
  @IsString()
  parentId?: string

  @IsOptional()
  @IsInt()
  sortOrder?: number
}
