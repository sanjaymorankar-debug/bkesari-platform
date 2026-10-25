import { IsString } from 'class-validator'

export class CreateDonationCauseDto {
  @IsString()
  code!: string

  @IsString()
  label!: string
}
