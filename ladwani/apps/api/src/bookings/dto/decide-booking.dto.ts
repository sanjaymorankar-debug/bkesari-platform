import { IsIn, IsOptional, IsString } from 'class-validator'

export class DecideBookingDto {
  @IsIn(['APPROVED', 'DECLINED'])
  decision!: 'APPROVED' | 'DECLINED'

  @IsOptional()
  @IsString()
  reason?: string
}
