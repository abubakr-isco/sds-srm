import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { api, login, makeUser, prisma, resetDb, Session, startApp } from './helpers';

describe('Access control', () => {
  let app: INestApplication;
  let admin: Session, d1: Session, d2: Session;
  let d1Id: string, d2Id: string;

  beforeAll(async () => { app = await startApp(); });
  beforeEach(async () => {
    await resetDb();
    await makeUser('admin@sds.local', Role.admin);
    d1Id = (await makeUser('d1@sds.local', Role.dispatcher)).id;
    d2Id = (await makeUser('d2@sds.local', Role.dispatcher)).id;
    admin = await login(app, 'admin@sds.local');
    d1 = await login(app, 'd1@sds.local');
    d2 = await login(app, 'd2@sds.local');
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('dispatchers see only their own loads plus the unassigned pool', async () => {
    await api(app, admin).post('/records/loads', { load_number: 'POOL-1', total: 100 });
    await api(app, admin).post('/records/loads', { load_number: 'D1-1', total: 100, assigned_to: d1Id });
    await api(app, admin).post('/records/loads', { load_number: 'D2-1', total: 100, assigned_to: d2Id });
    const mine = (await api(app, d1).get('/records/loads?select=*&order=load_number.asc')).body.map((l: { load_number: string }) => l.load_number);
    expect(mine).toEqual(['D1-1', 'POOL-1']);
    expect((await api(app, admin).get('/records/loads')).body).toHaveLength(3);
  });

  it("a dispatcher cannot read, change or delete another dispatcher's load (404, not leaked)", async () => {
    const [load] = (await api(app, admin).post('/records/loads', { load_number: 'D2-1', total: 100, assigned_to: d2Id })).body;
    expect((await api(app, d1).get(`/records/loads?id=eq.${load.id}`)).body).toEqual([]);
    expect((await api(app, d1).patch(`/records/loads?id=eq.${load.id}`, { assigned_to: d1Id })).status).toBe(404);
    expect((await api(app, d1).del(`/records/loads?id=eq.${load.id}`)).status).toBe(404);
  });

  it('a dispatcher can only create loads assigned to themselves', async () => {
    expect((await api(app, d1).post('/records/loads', { load_number: 'X-1', total: 1, assigned_to: d2Id })).status).toBe(403);
    expect((await api(app, d1).post('/records/loads', { load_number: 'X-2', total: 1 })).status).toBe(403);
    expect((await api(app, d1).post('/records/loads', { load_number: 'X-3', total: 1, assigned_to: d1Id })).status).toBe(201);
  });

  it('drivers are private to their dispatcher; only admins move drivers between dispatchers', async () => {
    const [own] = (await api(app, d1).post('/records/drivers', { first_name: 'A', last_name: 'B', truck_number: '1', type: 'company', dispatcher_id: d1Id })).body;
    expect((await api(app, d1).post('/records/drivers', { first_name: 'A', last_name: 'B', truck_number: '2', type: 'company', dispatcher_id: d2Id })).status).toBe(403);
    expect((await api(app, d2).get('/records/drivers')).body).toEqual([]);
    expect((await api(app, d1).patch(`/records/drivers?id=eq.${own.id}`, { dispatcher_id: d2Id })).status).toBe(403);
    expect((await api(app, admin).patch(`/records/drivers?id=eq.${own.id}`, { dispatcher_id: d2Id })).status).toBe(200);
    expect((await api(app, d2).get('/records/drivers')).body).toHaveLength(1);
  });

  it("a dispatcher cannot put another dispatcher's truck on a load", async () => {
    const [truck] = (await api(app, d2).post('/records/drivers', { first_name: 'A', last_name: 'B', truck_number: '9', type: 'owner', dispatcher_id: d2Id })).body;
    const res = await api(app, d1).post('/records/loads', { load_number: 'X-1', total: 1, assigned_to: d1Id, driver_id: truck.id });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/own drivers/);
  });

  it('only admins change company settings and manage staff', async () => {
    expect((await api(app, d1).patch('/records/settings?id=eq.1', { full_pct: 99 })).status).toBe(403);
    expect((await api(app, admin).patch('/records/settings?id=eq.1', { full_pct: 2.5 })).body[0].full_pct).toBe(2.5);
    expect((await api(app, d1).post('/staff/manage', { action: 'update', user_id: d1Id, full_name: 'Me', role: 'admin', is_active: true })).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: d1Id } })).role).toBe('dispatcher');
  });

  it('staff_profiles cannot be written through /records', async () => {
    expect((await api(app, admin).patch(`/records/staff_profiles?user_id=eq.${d1Id}`, { role: 'admin' })).status).toBe(405);
  });

  it("dispatchers see colleagues' names but not their fee %", async () => {
    await api(app, admin).post('/staff/manage', { action: 'update', user_id: d2Id, full_name: 'D2', role: 'dispatcher', is_active: true, full_pct: 7 });
    const rows = (await api(app, d1).get('/records/staff_profiles')).body;
    const other = rows.find((r: { user_id: string }) => r.user_id === d2Id);
    expect(other.full_name).toBe('D2');
    expect(other).not.toHaveProperty('full_pct');
    expect(rows.find((r: { user_id: string }) => r.user_id === d1Id)).toHaveProperty('full_pct', null);
  });

  it('activity log is recorded for the signed-in user and is private to them', async () => {
    expect((await api(app, d1).post('/records/activity_log', { action_text: 'x', user_email: 'spoof@x.com', user_id: d2Id })).status).toBe(403);
    const [row] = (await api(app, d1).post('/records/activity_log', { action_text: 'did something', user_email: 'spoof@x.com' })).body;
    expect(row.user_email).toBe('d1@sds.local');
    expect((await api(app, d2).get('/records/activity_log')).body).toEqual([]);
    expect((await api(app, admin).get('/records/activity_log')).body).toHaveLength(1);
    expect((await api(app, d1).del(`/records/activity_log?id=eq.${row.id}`)).status).toBe(405);
  });

  it('calendar notes: everyone reads, only the author (or an admin) deletes', async () => {
    const [note] = (await api(app, d1).post('/records/calendar_notes', { note_date: '2026-01-05', note_text: 'Call broker', created_by: d1Id })).body;
    expect((await api(app, d2).get('/records/calendar_notes')).body).toHaveLength(1);
    expect((await api(app, d2).del(`/records/calendar_notes?id=eq.${note.id}`)).status).toBe(403);
    expect((await api(app, d1).del(`/records/calendar_notes?id=eq.${note.id}`)).status).toBe(200);
  });

  it('admin notices are admin-only', async () => {
    expect((await api(app, d1).get('/records/admin_notices')).body).toEqual([]);
  });

  it('unknown tables and filter columns are rejected', async () => {
    expect((await api(app, admin).get('/records/users')).status).toBe(404);
    expect((await api(app, admin).get('/records/loads?password_hash=eq.x')).status).toBe(400);
    expect((await api(app, admin).get('/records/loads?order=password_hash.asc')).status).toBe(400);
  });

  it('test data endpoint is admin-only', async () => {
    expect((await api(app, d1).post('/dev/test-data', { action: 'fill' })).status).toBe(403);
  });
});
