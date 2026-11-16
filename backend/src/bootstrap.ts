import { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig, loadConfig } from './config';

/** Builds the HTTP app (shared by main.ts and the e2e tests). */
export async function createApp(options: NestApplicationOptions = {}): Promise<{ app: INestApplication; config: AppConfig }> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, ...options });
  app.useBodyParser('json', { limit: '2mb' });
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
  app.set('query parser', 'simple');
  app.disable('x-powered-by');
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Total-Count'],
  });
  app.enableShutdownHooks();
  return { app, config };
}
