import { IsIn, IsOptional, IsString } from 'class-validator'

export class RespondJoinRequestDto {
  @IsIn(['APPROVED', 'DECLINED'])
  decision!: 'APPROVED' | 'DECLINED'

  @IsOptional()
  @IsString()
  note?: string
}
