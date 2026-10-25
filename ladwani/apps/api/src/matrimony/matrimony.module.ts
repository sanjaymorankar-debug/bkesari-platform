import { Module } from '@nestjs/common'
import { MatrimonyService } from './matrimony.service'
import { MatrimonyController } from './matrimony.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { UploadsModule } from '../uploads/uploads.module'

@Module({
  imports: [NotificationsModule, UploadsModule],
  providers: [MatrimonyService],
  controllers: [MatrimonyController],
})
export class MatrimonyModule {}
