import { IsIn, IsString } from 'class-validator'
import { UPLOAD_PURPOSES, type UploadPurpose } from '@community-platform/shared-types'

export class PresignUploadDto {
  @IsIn(UPLOAD_PURPOSES)
  purpose!: UploadPurpose

  @IsString()
  contentType!: string
}
