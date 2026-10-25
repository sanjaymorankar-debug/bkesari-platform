import { Module } from '@nestjs/common'
import { PaymentsService } from './payments.service'
import { PaymentDispatchService } from './payment-dispatch.service'
import { PaymentsController } from './payments.controller'
import { WebhooksController } from './webhooks.controller'
import { PaymentGatewayModule } from '../common/payment-gateway/payment-gateway.module'
import { FeesModule } from '../fees/fees.module'

@Module({
  imports: [PaymentGatewayModule, FeesModule],
  providers: [PaymentsService, PaymentDispatchService],
  controllers: [PaymentsController, WebhooksController],
  exports: [PaymentDispatchService],
})
export class PaymentsModule {}
