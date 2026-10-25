import { Module } from '@nestjs/common'
import { DevGatewayService } from './dev-gateway.service'
import { RazorpayGatewayService } from './razorpay-gateway.service'
import { PAYMENT_GATEWAY } from './payment-gateway.interface'

/**
 * The active gateway is a deployment setting (PAYMENT_GATEWAY_PROVIDER env
 * var), not a code change — docs/10 §1. Defaults to DEV since no real
 * Razorpay credentials are configured in this environment; set it to
 * RAZORPAY once RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET/RAZORPAY_WEBHOOK_SECRET
 * are provided.
 */
@Module({
  providers: [
    DevGatewayService,
    RazorpayGatewayService,
    {
      provide: PAYMENT_GATEWAY,
      useFactory: (dev: DevGatewayService, razorpay: RazorpayGatewayService) => {
        return process.env.PAYMENT_GATEWAY_PROVIDER === 'RAZORPAY' ? razorpay : dev
      },
      inject: [DevGatewayService, RazorpayGatewayService],
    },
  ],
  exports: [PAYMENT_GATEWAY, DevGatewayService],
})
export class PaymentGatewayModule {}
