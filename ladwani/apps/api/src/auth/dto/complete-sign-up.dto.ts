import { Equals, IsIn, IsOptional, IsString, MinLength } from 'class-validator'

export const ID_PROOF_KINDS = ['AADHAAR_MASKED', 'VOTER_ID', 'PAN', 'DRIVING_LICENCE', 'PASSPORT', 'OTHER'] as const

/** Step 4 of sign-up: the ID proof the person uploaded, and what they agreed to. */
export class CompleteSignUpDto {
  /** An ACTIVE DOCUMENT upload of the caller's own (POST /uploads/presign, purpose DOCUMENT). */
  @IsString()
  @MinLength(1)
  idProofFileId!: string

  /** Which document it is, for the reviewer. Aadhaar only masked (first 8 digits covered). */
  @IsOptional()
  @IsIn(ID_PROOF_KINDS)
  idProofKind?: (typeof ID_PROOF_KINDS)[number]

  /** "The details I gave are true and the document is mine." */
  @Equals(true, { message: 'Confirm the self-declaration to continue' })
  selfDeclaration!: boolean

  /** Consent to LadWani storing and processing these details (DPDP Act 2023). */
  @Equals(true, { message: 'Give your consent to continue' })
  dataConsent!: boolean
}
