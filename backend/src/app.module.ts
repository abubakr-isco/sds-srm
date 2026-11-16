import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountController } from './account/account.controller';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { APP_CONFIG, loadConfig } from './config';
import { TestDataController } from './dev/test-data.controller';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { LoadsTable } from './records/loads.table';
import {
  ActivityLogTable, AdminNoticesTable, CalendarNotesTable, CustomCitiesTable, DriversTable, LoadHistoryTable, SettingsTable, StaffProfilesTable,
} from './records/other.tables';
import { RecordsController } from './records/records.controller';
import { StaffController, StaffService } from './staff/staff.controller';

@Module({
  imports: [
    JwtModule.register({}),
    // Per-IP limit for the routes guarded by ThrottlerGuard (sign-in and token refresh).
    ThrottlerModule.forRootAsync({
      useFactory: () => ({ throttlers: [{ name: 'auth', ttl: 60_000, limit: loadConfig().authRateLimitPerMinute }] }),
    }),
  ],
  controllers: [HealthController, AuthController, AccountController, StaffController, RecordsController, TestDataController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    PrismaService, AuthService, StaffService,
    LoadsTable, DriversTable, SettingsTable, StaffProfilesTable, CalendarNotesTable, CustomCitiesTable, ActivityLogTable, LoadHistoryTable, AdminNoticesTable,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
