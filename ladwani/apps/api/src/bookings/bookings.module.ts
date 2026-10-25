import { Module } from '@nestjs/common'
import { BookingsService } from './bookings.service'
import { BookingsController } from './bookings.controller'
import { ReviewsService } from './reviews.service'
import { ReviewsController } from './reviews.controller'
import { AssetsModule } from '../assets/assets.module'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [AssetsModule, NotificationsModule],
  providers: [BookingsService, ReviewsService],
  controllers: [BookingsController, ReviewsController],
})
export class BookingsModule {}
