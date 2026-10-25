import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { VisitorThrottlerGuard } from './common/visitor-throttler.guard'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { FamilyModule } from './family/family.module'
import { MembersModule } from './members/members.module'
import { ApprovalQueueModule } from './approval-queue/approval-queue.module'
import { LookupsModule } from './lookups/lookups.module'
import { MatrimonyModule } from './matrimony/matrimony.module'
import { CommunityModule } from './community/community.module'
import { NotificationsModule } from './notifications/notifications.module'
import { AssetsModule } from './assets/assets.module'
import { BookingsModule } from './bookings/bookings.module'
import { FeesModule } from './fees/fees.module'
import { PaymentsModule } from './payments/payments.module'
import { ConfigModule } from './config/config.module'
import { AuditLogModule } from './audit-log/audit-log.module'
import { ReportsModule } from './reports/reports.module'
import { UploadsModule } from './uploads/uploads.module'
import { HealthModule } from './health/health.module'
import { AuditInterceptor } from './common/interceptors/audit.interceptor'

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    FamilyModule,
    MembersModule,
    ApprovalQueueModule,
    LookupsModule,
    MatrimonyModule,
    CommunityModule,
    NotificationsModule,
    AssetsModule,
    BookingsModule,
    FeesModule,
    PaymentsModule,
    ConfigModule,
    AuditLogModule,
    ReportsModule,
    UploadsModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
  ],
  providers: [
    { provide: APP_GUARD, useClass: VisitorThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
