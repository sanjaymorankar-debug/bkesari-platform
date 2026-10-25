import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateFamilyDto {
  @IsString()
  @MinLength(2)
  name!: string

  @IsOptional()
  @IsString()
  surname?: string

  @IsOptional()
  @IsString()
  kuladevata?: string

  @IsOptional()
  @IsString()
  gotra?: string

  @IsOptional()
  @IsString()
  nativeVillage?: string

  @IsOptional()
  @IsString()
  nativeDistrict?: string

  @IsOptional()
  @IsString()
  nativeState?: string

  /** Set true only when the submitter has reviewed possible-duplicate results and wants to proceed anyway (J11). */
  @IsOptional()
  @IsBoolean()
  acknowledgedDuplicates?: boolean
}
