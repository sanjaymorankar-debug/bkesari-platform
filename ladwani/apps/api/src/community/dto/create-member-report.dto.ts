import { IsString, MinLength } from 'class-validator'

export class CreateMemberReportDto {
  @IsString()
  memberId!: string

  @IsString()
  @MinLength(3)
  reason!: string
}
