import { IsString } from 'class-validator'

export class CreateSkillDto {
  @IsString()
  code!: string

  @IsString()
  label!: string
}
