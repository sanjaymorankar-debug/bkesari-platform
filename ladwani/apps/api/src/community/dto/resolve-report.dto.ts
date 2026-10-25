import { IsIn, IsOptional, IsString } from 'class-validator'

export class ResolveReportDto {
  @IsIn(['DISMISSED', 'ACTIONED'])
  decision!: 'DISMISSED' | 'ACTIONED'

  @IsOptional()
  @IsString()
  note?: string
}
