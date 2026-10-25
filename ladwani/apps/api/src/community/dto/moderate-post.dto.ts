import { IsIn, IsOptional, IsString } from 'class-validator'

export class ModeratePostDto {
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED'

  @IsOptional()
  @IsString()
  note?: string
}
