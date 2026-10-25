import { IsString } from 'class-validator'

/** Karta invites an existing platform member into their family (J2 step 3b) — requires that member's own consent before it reaches Operator review. */
export class InviteExistingMemberDto {
  @IsString()
  existingMemberId!: string

  @IsString()
  relatedToMemberId!: string

  @IsString()
  relationshipTypeCode!: string
}
