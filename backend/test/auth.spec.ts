import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { api, login, makeUser, prisma, resetDb, startApp } from './helpers';

describe('Authentication', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await startApp(); });
  beforeEach(resetDb);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('stores passwords as scrypt hashes, never in plain text', async () => {
    const u = await makeUser('a@sds.local', Role.admin, 'Secret-pass-1');
    expect(u.passwordHash).toMatch(/^scrypt\$/);
    expect(u.passwordHash).not.toContain('Secret-pass-1');
  });

  it('signs in with valid credentials (case-insensitive email) and returns the frontend contract', async () => {
    await makeUser('a@sds.local', Role.admin);
    const res = await api(app).post('/auth/login', { email: '  A@SDS.local ', password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ access_token: expect.any(String), refresh_token: expect.any(String), user: { id: expect.any(String), email: 'a@sds.local' } }));
  });

  it('rejects wrong passwords and unknown emails with the same 401 and unified error body', async () => {
    await makeUser('a@sds.local', Role.admin);
    const wrong = await api(app).post('/auth/login', { email: 'a@sds.local', password: 'nope-nope' });
    const unknown = await api(app).post('/auth/login', { email: 'ghost@sds.local', password: 'nope-nope' });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(expect.objectContaining({ statusCode: 401, error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.', path: '/api/auth/login' }));
    }
  });

  it('validates the login body (400)', async () => {
    const res = await api(app).post('/auth/login', { email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    await makeUser('a@sds.local', Role.admin);
    for (let i = 0; i < 3; i += 1) expect((await api(app).post('/auth/login', { email: 'a@sds.local', password: 'bad-password' })).status).toBe(401);
    const locked = await api(app).post('/auth/login', { email: 'a@sds.local', password: 'Password123!' });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('ACCOUNT_LOCKED');
  });

  it('refuses inactive accounts', async () => {
    await makeUser('off@sds.local', Role.dispatcher, 'Password123!', { isActive: false });
    expect((await api(app).post('/auth/login', { email: 'off@sds.local', password: 'Password123!' })).status).toBe(401);
  });

  it('requires a valid bearer token on protected routes', async () => {
    expect((await api(app).get('/records/loads')).status).toBe(401);
    const res = await api(app, { token: 'garbage', refresh: '', userId: '' }).get('/records/loads');
    expect(res.status).toBe(401);
  });

  it('rotates refresh tokens: the old one stops working', async () => {
    await makeUser('a@sds.local', Role.admin);
    const s = await login(app, 'a@sds.local');
    const first = await api(app).post('/auth/refresh', { refresh_token: s.refresh });
    expect(first.status).toBe(200);
    expect(first.body.refresh_token).not.toBe(s.refresh);
    expect((await api(app).post('/auth/refresh', { refresh_token: s.refresh })).status).toBe(401);
    expect((await api(app, { ...s, token: first.body.access_token }).get('/records/loads')).status).toBe(200);
  });

  it('logout revokes the session immediately', async () => {
    await makeUser('a@sds.local', Role.admin);
    const s = await login(app, 'a@sds.local');
    expect((await api(app, s).post('/auth/logout', {})).status).toBe(204);
    expect((await api(app, s).get('/records/loads')).status).toBe(401);
    expect((await api(app).post('/auth/refresh', { refresh_token: s.refresh })).status).toBe(401);
  });

  it('deactivating an employee cuts off their existing token at once', async () => {
    const admin = await makeUser('a@sds.local', Role.admin);
    const d = await makeUser('d@sds.local', Role.dispatcher);
    const ds = await login(app, 'd@sds.local');
    const as = await login(app, 'a@sds.local');
    expect((await api(app, as).post('/staff/manage', { action: 'update', user_id: d.id, full_name: 'D', role: 'dispatcher', is_active: false })).status).toBe(200);
    const res = await api(app, ds).get('/records/loads');
    expect(res.status).toBe(401);
    void admin;
  });

  it('health endpoint is public', async () => {
    expect((await api(app).get('/health')).body).toEqual({ status: 'ok' });
  });
});
