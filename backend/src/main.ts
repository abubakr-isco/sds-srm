import './load-env';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';

async function main() {
  const { app, config } = await createApp({ logger: ['error', 'warn', 'log'] });
  await app.listen(config.port);
  new Logger('Bootstrap').log(`SDS CRM API listening on http://localhost:${config.port}/api (${config.nodeEnv})`);
}

main().catch((error) => {
  console.error('Failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
