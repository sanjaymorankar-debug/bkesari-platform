import { BadRequestException, Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common'
import { PaymentDispatchService } from './payment-dispatch.service'
import { PaymentsService } from './payments.service'
import { CreateOrderDto } from './dto/create-order.dto'
import { VerifyPaymentDto } from './dto/verify-payment.dto'
import { RefundPaymentDto } from './dto/refund-payment.dto'
import { DevGatewayService } from '../common/payment-gateway/dev-gateway.service'
import { PAYMENT_GATEWAY, type PaymentGateway } from '../common/payment-gateway/payment-gateway.interface'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Audited } from '../common/decorators/audited.decorator'
import { PrismaService } from '../prisma/prisma.service'
import type { JwtPayload } from '../auth/strategies/jwt.strategy'

@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(
    private dispatch: PaymentDispatchService,
    private payments: PaymentsService,
    private prisma: PrismaService,
    private devGateway: DevGatewayService,
    @Inject(PAYMENT_GATEWAY) private gateway: PaymentGateway,
  ) {}

  @Post('orders')
  @Audited('payment.order.create')
  async createOrder(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto) {
    return { data: await this.dispatch.createOrder(user.sub, dto) }
  }

  /**
   * Manually triggered rather than cron-scheduled — no job scheduler exists yet (same limitation
   * noted for booking expiry in M3). docs/19 §4 describes this running every 15 minutes in production.
   */
  @Post('reconciliation/run')
  @UseGuards(PermissionsGuard)
  @Permissions('refund:approve')
  @Audited('payment.reconciliation.run')
  async runReconciliation() {
    return { data: await this.payments.reconcile(this.gateway.code) }
  }

  @Get(':id')
  async getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const transaction = await this.prisma.paymentTransaction.findUnique({ where: { id }, include: { gatewayTransaction: true, refunds: true } })
    if (!transaction || transaction.userId !== user.sub) throw new BadRequestException('Payment not found.')
    return { data: transaction }
  }

  @Post(':id/verify')
  @Audited('payment.verify')
  async verify(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: VerifyPaymentDto) {
    return { data: await this.dispatch.verifyAndApply(user.sub, id, dto.gatewayPaymentId, dto.gatewaySignature) }
  }

  @Post(':id/refund')
  @UseGuards(PermissionsGuard)
  @Permissions('refund:approve')
  @Audited('payment.refund')
  async refund(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: RefundPaymentDto) {
    return { data: await this.payments.initiateRefund(user.sub, id, dto.amount, dto.reason) }
  }

  /** Dev-only: simulates the gateway checkout succeeding, since there is no real Razorpay account wired up in this environment. */
  @Post(':id/dev-simulate')
  async devSimulate(@Param('id') id: string) {
    if (this.gateway.code !== 'DEV') throw new BadRequestException('The dev-simulate endpoint is only available when the DEV gateway is active.')
    const transaction = await this.prisma.paymentTransaction.findUnique({ where: { id }, include: { gatewayTransaction: true } })
    if (!transaction?.gatewayTransaction?.gatewayOrderId) throw new BadRequestException('No gateway order found for this payment.')
    return { data: this.devGateway.simulatePaymentSuccess(transaction.gatewayTransaction.gatewayOrderId) }
  }
}
