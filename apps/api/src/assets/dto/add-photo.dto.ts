import { IsInt, IsOptional, IsUrl } from 'class-validator'

export class AddPhotoDto {
  @IsUrl({ require_tld: false })
  url!: string

  @IsOptional()
  @IsInt()
  sortOrder?: number
}
