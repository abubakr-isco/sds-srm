import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { api, makeUser, prisma, resetDb, startApp } from './helpers';

describe('Rate limits', () => {
  let app: INestApplication;
  const saved = { api: process.env.API_RATE_LIMIT_PER_MINUTE, auth: process.env.AUTH_RATE_LIMIT_PER_MINUTE };
  beforeAll(async () => {
    process.env.API_RATE_LIMIT_PER_MINUTE = '8';
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
    app = await startApp();
  });
  beforeEach(resetDb);
  afterAll(async () => {
    process.env.API_RATE_LIMIT_PER_MINUTE = saved.api;
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = saved.auth;
    await app.close();
    await prisma.$disconnect();
  });

  it('limits sign-in attempts per IP more strictly than the rest of the API', async () => {
    await makeUser('a@sds.local', Role.admin);
    const codes: number[] = [];
    for (let i = 0; i < 4; i += 1) codes.push((await api(app).post('/auth/login', { email: 'a@sds.local', password: 'wrong-one' })).status);
    expect(codes.slice(0, 3).every((c) => c === 401)).toBe(true);
    expect(codes[3]).toBe(429);
  });

  it('limits every API route per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 10; i += 1) codes.push((await api(app).get('/health')).status);
    expect(codes).toContain(429);
  });
});
