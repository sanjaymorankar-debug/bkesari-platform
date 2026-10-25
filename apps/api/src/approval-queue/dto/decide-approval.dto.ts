import { IsIn, IsOptional, IsString } from 'class-validator'

export class DecideApprovalDto {
  @IsIn(['APPROVED', 'REJECTED', 'RETURNED'])
  decision!: 'APPROVED' | 'REJECTED' | 'RETURNED'

  @IsOptional()
  @IsString()
  note?: string
}
