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
  app.set('trust proxy', trustProxySetting(process.env.TRUST_PROXY));
  app.set('query parser', 'simple');
  app.disable('x-powered-by');
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-SDS-CSRF'],
    exposedHeaders: ['X-Total-Count'],
    credentials: config.corsOrigins.length > 0, // the refresh cookie, for listed dev origins only
  });
  app.enableShutdownHooks();
  return { app, config };
}

/** TRUST_PROXY: "true" = one proxy in front, a number = that many proxies, anything else = none. */
export function trustProxySetting(value: string | undefined): number | false {
  if (value === 'true') return 1;
  const hops = Number(value);
  return Number.isInteger(hops) && hops > 0 ? hops : false;
}
