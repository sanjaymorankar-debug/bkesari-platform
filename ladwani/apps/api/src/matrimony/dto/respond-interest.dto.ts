import { IsIn } from 'class-validator'

export class RespondInterestDto {
  @IsIn(['ACCEPTED', 'DECLINED'])
  decision!: 'ACCEPTED' | 'DECLINED'
}
