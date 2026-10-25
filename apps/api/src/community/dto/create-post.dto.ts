import { IsOptional, IsString, MinLength } from 'class-validator'

export class CreatePostDto {
  @IsString()
  postTypeCode!: string

  @IsOptional()
  @IsString()
  title?: string

  @IsString()
  @MinLength(1)
  content!: string

  @IsOptional()
  @IsString()
  targetAreaId?: string
}
