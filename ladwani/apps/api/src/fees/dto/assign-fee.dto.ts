import { Type } from 'class-transformer'
import { IsDate, IsOptional, IsString } from 'class-validator'

export class AssignFeeDto {
  @IsString()
  familyId!: string

  @IsString()
  feeRuleId!: string

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveDate?: Date

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date
}
