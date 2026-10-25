import { IsString, MinLength } from 'class-validator'

export class CreateReportDto {
  @IsString()
  @MinLength(3)
  reason!: string
}
