import { IsString } from 'class-validator'

export class AddFacilityDto {
  @IsString()
  facilityCode!: string
}
