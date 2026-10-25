import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator'

export class RegisterAssetDto {
  @IsString()
  categoryCode!: string

  @IsString()
  @MinLength(2)
  name!: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsString()
  addressLine?: string

  @IsOptional()
  @IsString()
  city?: string

  @IsOptional()
  @IsString()
  district?: string

  @IsOptional()
  @IsString()
  state?: string

  @IsOptional()
  @IsString()
  pincode?: string

  @IsOptional()
  @IsString()
  areaId?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number

  @IsOptional()
  @IsBoolean()
  bookingApprovalRequired?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationDeadlineDays?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  cancellationRefundPercent?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number
}
