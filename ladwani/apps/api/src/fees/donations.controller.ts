import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common'
import { DonationsService } from './donations.service'
import { InitiateDonationDto } from './dto/initiate-donation.dto'
import { CreateDonationCauseDto } from './dto/create-donation-cause.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('donations')
@UseGuards(JwtAuthGuard)
export class DonationsController {
  constructor(private donations: DonationsService) {}

  @Get('causes')
  async listCauses() {
    return { data: await this.donations.listCauses() }
  }

  @Post('causes')
  @UseGuards(PermissionsGuard)
  @Permissions('fee:configure')
  @Audited('donation.cause.create')
  async createCause(@Body() dto: CreateDonationCauseDto) {
    return { data: await this.donations.createCause(dto.code, dto.label) }
  }

  @Post()
  @Audited('donation.initiate')
  async initiate(@CurrentUser() user: JwtPayload, @Body() dto: InitiateDonationDto) {
    return { data: await this.donations.initiateDonation(user.sub, dto.causeCode, dto.amount) }
  }

  @Get('mine')
  async mine(@CurrentUser() user: JwtPayload) {
    return { data: await this.donations.myDonations(user.sub) }
  }
}
