import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { BookingsService } from './bookings.service'
import { CreateBookingDto } from './dto/create-booking.dto'
import { DecideBookingDto } from './dto/decide-booking.dto'
import { VerifyQrDto } from './dto/verify-qr.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions('booking:create')
  @Audited('booking.create')
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBookingDto) {
    return { data: await this.bookings.createBooking(user.sub, dto) }
  }

  @Get('mine')
  async mine(@CurrentUser() user: JwtPayload) {
    return { data: await this.bookings.myBookings(user.sub) }
  }

  @Get('owner')
  @UseGuards(PermissionsGuard)
  @Permissions('asset:manage:own')
  async owner(@CurrentUser() user: JwtPayload) {
    return { data: await this.bookings.ownerBookings(user.sub) }
  }

  @Post('verify-qr')
  @UseGuards(PermissionsGuard)
  @Permissions('asset:manage:own')
  @Audited('booking.qr.verify')
  async verifyQr(@CurrentUser() user: JwtPayload, @Body() dto: VerifyQrDto) {
    return { data: await this.bookings.verifyQr(user.sub, dto.token) }
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.bookings.getById(user.sub, id) }
  }

  @Post(':id/decide')
  @UseGuards(PermissionsGuard)
  @Permissions('asset:manage:own')
  @Audited('booking.decide')
  async decide(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: DecideBookingDto) {
    return { data: await this.bookings.decideRequest(user.sub, id, dto.decision, dto.reason) }
  }

  @Post(':id/confirm-payment')
  @Audited('booking.confirm_payment')
  async confirmPayment(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.bookings.confirmPayment(user.sub, id) }
  }

  @Post(':id/cancel')
  @Audited('booking.cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body('reason') reason?: string) {
    return { data: await this.bookings.cancelBooking(user.sub, id, reason) }
  }

  @Post(':id/complete')
  @UseGuards(PermissionsGuard)
  @Permissions('asset:manage:own')
  @Audited('booking.complete')
  async complete(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.bookings.completeBooking(user.sub, id) }
  }

  @Get(':id/qr')
  async getQr(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return { data: await this.bookings.getQrToken(user.sub, id) }
  }
}
