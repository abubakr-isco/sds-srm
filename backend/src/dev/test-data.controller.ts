import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsIn } from 'class-validator';
import { Actor, CurrentActor } from '../auth/actor';
import { APP_CONFIG, AppConfig } from '../config';
import { forbidden, notFound } from '../common/errors';
import { validateBody } from '../common/validation';
import { PrismaService } from '../prisma.service';
import { clearTestData, fillTestData } from './test-data';

class TestDataDto { @IsIn(['fill', 'clear']) action: 'fill' | 'clear'; }

/** POST /api/dev/test-data — only when ENABLE_TEST_DATA=true and NODE_ENV is not production. */
@Controller('dev')
export class TestDataController {
  constructor(private readonly prisma: PrismaService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Post('test-data') @HttpCode(200)
  async run(@CurrentActor() actor: Actor, @Body() body: unknown) {
    if (!this.config.enableTestData) throw notFound('Test data is disabled on this server.');
    if (actor.role !== Role.admin) throw forbidden('Administrator access required.');
    const { action } = validateBody(TestDataDto, body);
    return this.prisma.$transaction(async (tx) => {
      if (action === 'clear') { await clearTestData(tx); return { cleared: true }; }
      return fillTestData(tx, actor, this.config.testDataPassword);
    }, { timeout: 30000 });
  }
}
