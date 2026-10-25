import { IsString } from 'class-validator'

export class VerifyQrDto {
  @IsString()
  token!: string
}
