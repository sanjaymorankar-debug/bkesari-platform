import { IsNumber, IsString, Min } from 'class-validator'

export class AddServiceDto {
  @IsString()
  code!: string

  @IsString()
  label!: string

  @IsNumber()
  @Min(0)
  amount!: number
}
