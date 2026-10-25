import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'
import { FeesService } from './fees.service'
import { CreateFeeTypeDto } from './dto/create-fee-type.dto'
import { CreateFinancialYearDto } from './dto/create-financial-year.dto'
import { CreateFeeRuleDto } from './dto/create-fee-rule.dto'
import { AssignFeeDto } from './dto/assign-fee.dto'
import { RecordOfflinePaymentDto } from './dto/record-offline-payment.dto'
import { CreateWaiverDto } from './dto/create-waiver.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import { FamilyAuthorizationService } from '../common/family-authorization/family-authorization.service'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('fees')
@UseGuards(JwtAuthGuard)
export class FeesController {
  constructor(
    private fees: FeesService,
    private familyAuth: FamilyAuthorizationService,
  ) {}

  @Post('types')
  @UseGuards(PermissionsGuard)
  @Permissions('fee:configure')
  async createType(@Body() dto: CreateFeeTypeDto) {
    return { data: await this.fees.createFeeType(dto) }
  }

  @Post('financial-years')
  @UseGuards(PermissionsGuard)
  @Permissions('fee:configure')
  async createFinancialYear(@Body() dto: CreateFinancialYearDto) {
    return { data: await this.fees.createFinancialYear(dto) }
  }

  @Post('rules')
  @UseGuards(PermissionsGuard)
  @Permissions('fee:configure')
  async createRule(@Body() dto: CreateFeeRuleDto) {
    return { data: await this.fees.createFeeRule(dto) }
  }

  @Get('rules')
  @UseGuards(PermissionsGuard)
  @Permissions('fee:configure')
  async listRules() {
    return { data: await this.fees.listFeeRules() }
  }

  @Post('assign')
  @UseGuards(PermissionsGuard)
  @Permissions('fee:configure')
  @Audited('fee.invoice.create')
  async assign(@Body() dto: AssignFeeDto) {
    return { data: await this.fees.assignToFamily(dto) }
  }

  @Get('families/:familyId/invoices')
  async listForFamily(@Param('familyId') familyId: string, @CurrentUser() user: JwtPayload) {
    await this.familyAuth.assertIsKarta(user.sub, familyId)
    return { data: await this.fees.listInvoicesForFamily(familyId) }
  }

  @Get('invoices/:id')
  async getInvoice(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.fees.assertKartaOfInvoiceFamily(user.sub, id)
    return { data: await this.fees.getInvoice(id) }
  }

  @Post('invoices/:id/offline-payments')
  @UseGuards(PermissionsGuard)
  @Permissions('fee:pay:family')
  @Audited('fee.offline_payment.record')
  async recordOfflinePayment(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: RecordOfflinePaymentDto) {
    const offlinePayment = await this.fees.recordOfflinePayment(user.sub, id, dto)
    const approval = await this.fees.submitOfflinePaymentForVerification(user.sub, offlinePayment.id)
    return { data: { offlinePayment, approval } }
  }

  @Post('invoices/:id/waivers')
  @UseGuards(PermissionsGuard)
  @Permissions('fee:configure')
  @Audited('fee.waiver.create')
  async createWaiver(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateWaiverDto) {
    return { data: await this.fees.createWaiver(user.sub, id, dto) }
  }
}
