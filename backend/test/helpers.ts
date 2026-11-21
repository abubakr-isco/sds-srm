import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/bootstrap';

export const prisma = new PrismaClient();

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE load_history, loads, drivers, calendar_notes, custom_cities, activity_log,
    admin_notices, sessions, users RESTART IDENTITY CASCADE`);
  await prisma.settings.upsert({ where: { id: 1 }, update: { fullPct: 2, partialPct: 3, dispatcherName: '', theme: 'dark', avatarUrl: null }, create: { id: 1 } });
}

export async function startApp(): Promise<INestApplication> {
  const { app } = await createApp({ logger: false });
  // Listen once on a fixed ephemeral port; otherwise supertest starts a new server per request,
  // and keep-alive sockets on Node >= 19 can hit a closed server (flaky empty 400s).
  await app.listen(0, '127.0.0.1');
  return app;
}

export async function makeUser(email: string, role: Role, password = 'Password123!', extra: { isActive?: boolean; fullName?: string } = {}) {
  return prisma.user.create({
    data: { email, role, fullName: extra.fullName ?? email.split('@')[0], isActive: extra.isActive ?? true, passwordHash: await hashPassword(password) },
  });
}

/** `refresh` is the raw refresh token, taken from the HttpOnly cookie the server set. */
export interface Session { token: string; refresh: string; userId: string; }

export function refreshCookie(res: request.Response): string {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('sds_refresh='));
  return raw ? decodeURIComponent(raw.split(';')[0].slice('sds_refresh='.length)) : '';
}

export async function login(app: INestApplication, email: string, password = 'Password123!'): Promise<Session> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').set('X-SDS-CSRF', '1').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.access_token, refresh: refreshCookie(res), userId: res.body.user.id };
}

/** POST /api/auth/refresh the way the browser does it: refresh cookie + CSRF header. */
export function refreshWith(app: INestApplication, refreshToken: string, headers: Record<string, string> = { 'X-SDS-CSRF': '1' }) {
  const r = request(app.getHttpServer()).post('/api/auth/refresh').set('Cookie', `sds_refresh=${encodeURIComponent(refreshToken)}`);
  for (const [k, v] of Object.entries(headers)) r.set(k, v);
  return r.send({});
}

/** Small client mirroring src/api.js on the frontend. */
export function api(app: INestApplication, s?: Session) {
  const auth = (r: request.Test) => {
    r.set('X-SDS-CSRF', '1');
    return s ? r.set('Authorization', `Bearer ${s.token}`) : r;
  };
  const http = () => request(app.getHttpServer());
  return {
    get: (path: string) => auth(http().get(`/api${path}`)),
    post: (path: string, body: object) => auth(http().post(`/api${path}`).send(body)),
    patch: (path: string, body: object) => auth(http().patch(`/api${path}`).send(body)),
    del: (path: string) => auth(http().delete(`/api${path}`)),
  };
}

export const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
