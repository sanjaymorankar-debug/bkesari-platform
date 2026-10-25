import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class CreateReviewDto {
  @IsString()
  bookingId!: string

  @IsInt()
  @Min(1)
  @Max(5)
  overallScore!: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  cleanlinessScore?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  facilitiesScore?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  serviceScore?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  valueScore?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  locationScore?: number

  @IsOptional()
  @IsString()
  comment?: string
}
