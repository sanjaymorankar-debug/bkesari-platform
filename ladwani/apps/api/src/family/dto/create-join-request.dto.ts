import { IsOptional, IsString } from 'class-validator'

export class CreateJoinRequestDto {
  /** An existing member of the target family this requester is related to (e.g. "I am the son of this member"). */
  @IsString()
  relatedToMemberId!: string

  /** RelationshipType.code describing the requester's relationship TO relatedToMemberId. */
  @IsString()
  relationshipTypeCode!: string

  @IsOptional()
  @IsString()
  note?: string
}
