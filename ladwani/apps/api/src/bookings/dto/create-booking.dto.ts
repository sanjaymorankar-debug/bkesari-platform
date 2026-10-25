import { Type } from 'class-transformer'
import { IsArray, IsDate, IsOptional, IsString, ValidateNested } from 'class-validator'

export class BookingGuestDto {
  @IsString()
  name!: string

  @IsOptional()
  @IsString()
  contact?: string
}

export class CreateBookingDto {
  @IsString()
  assetId!: string

  @Type(() => Date)
  @IsDate()
  date!: Date

  @IsOptional()
  @IsString()
  slot?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceCodes?: string[]

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingGuestDto)
  guests?: BookingGuestDto[]
}
