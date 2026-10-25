import { IsNumber, IsString, Min } from 'class-validator'

export class InitiateDonationDto {
  @IsString()
  causeCode!: string

  @IsNumber()
  @Min(1)
  amount!: number
}
