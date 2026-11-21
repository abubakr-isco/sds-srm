import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ExecutionContext, Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
    // Per-IP limits on every route: a general one, and a strict one for sign-in / token refresh.
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const config = loadConfig();
        const isAuthRoute = (ctx: ExecutionContext) => /^\/api\/auth\/(login|refresh)\b/.test(ctx.switchToHttp().getRequest().path);
        return {
          throttlers: [
            { name: 'api', ttl: 60_000, limit: config.apiRateLimitPerMinute },
            { name: 'auth', ttl: 60_000, limit: config.authRateLimitPerMinute, skipIf: (ctx) => !isAuthRoute(ctx) },
          ],
        };
      },
    }),
  ],
  controllers: [HealthController, AuthController, AccountController, StaffController, RecordsController, TestDataController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    PrismaService, AuthService, StaffService,
    LoadsTable, DriversTable, SettingsTable, StaffProfilesTable, CalendarNotesTable, CustomCitiesTable, ActivityLogTable, LoadHistoryTable, AdminNoticesTable,
    // Rate limits run before authentication, so floods of bad tokens are limited too.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
