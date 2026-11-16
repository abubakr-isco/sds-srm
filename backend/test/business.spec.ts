import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import { api, day, login, makeUser, prisma, resetDb, Session, startApp } from './helpers';

describe('Business rules', () => {
  let app: INestApplication;
  let admin: Session, d1: Session, d2: Session;
  let adminId: string, d1Id: string, d2Id: string;

  beforeAll(async () => { app = await startApp(); });
  beforeEach(async () => {
    await resetDb();
    adminId = (await makeUser('admin@sds.local', Role.admin)).id;
    d1Id = (await makeUser('d1@sds.local', Role.dispatcher)).id;
    d2Id = (await makeUser('d2@sds.local', Role.dispatcher)).id;
    admin = await login(app, 'admin@sds.local');
    d1 = await login(app, 'd1@sds.local');
    d2 = await login(app, 'd2@sds.local');
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  const newLoad = async (s: Session, body: object) => {
    const res = await api(app, s).post('/records/loads', body);
    if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
    return res.body[0];
  };

  it('stores money exactly and returns it with two decimals', async () => {
    const load = await newLoad(admin, { load_number: 'M-1', total: 1234.56 });
    expect(load.total).toBe('1234.56');
    const db = await prisma.load.findUniqueOrThrow({ where: { id: load.id } });
    expect(db.total.toString()).toBe('1234.56');
    expect((await api(app, admin).post('/records/loads', { load_number: 'M-2', total: 1.005 })).status).toBe(400);
    expect((await api(app, admin).post('/records/loads', { load_number: 'M-3', total: -1 })).status).toBe(400);
  });

  it('rejects duplicate load numbers with 409', async () => {
    await newLoad(admin, { load_number: 'DUP', total: 1 });
    const res = await api(app, admin).post('/records/loads', { load_number: 'DUP', total: 1 });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/duplicate/);
  });

  it('a dispatcher claims a pool load; another dispatcher then cannot take it', async () => {
    const pool = await newLoad(admin, { load_number: 'P-1', total: 10 });
    const claimed = await api(app, d1).patch(`/records/loads?id=eq.${pool.id}`, { assigned_to: d1Id });
    expect(claimed.body[0].assigned_to).toBe(d1Id);
    expect((await api(app, d2).patch(`/records/loads?id=eq.${pool.id}`, { assigned_to: d2Id })).status).toBe(404);
  });

  it('transfer: only dispatcher + cleared truck may change, to an active dispatcher', async () => {
    const [truck] = (await api(app, d1).post('/records/drivers', { first_name: 'A', last_name: 'B', truck_number: '7', type: 'company', dispatcher_id: d1Id })).body;
    const load = await newLoad(d1, { load_number: 'T-1', total: 10, assigned_to: d1Id, driver_id: truck.id });
    expect((await api(app, d1).patch(`/records/loads?id=eq.${load.id}`, { assigned_to: d2Id })).status).toBe(403); // truck not cleared
    expect((await api(app, d1).patch(`/records/loads?id=eq.${load.id}`, { assigned_to: d2Id, driver_id: null, total: 99 })).status).toBe(403);
    expect((await api(app, d1).patch(`/records/loads?id=eq.${load.id}`, { assigned_to: adminId, driver_id: null })).status).toBe(422);
    const ok = await api(app, d1).patch(`/records/loads?id=eq.${load.id}`, { assigned_to: d2Id, driver_id: null });
    expect(ok.status).toBe(200);
    expect(ok.body[0]).toEqual(expect.objectContaining({ assigned_to: d2Id, driver_id: null }));
  });

  it("admin cannot pair a load with another dispatcher's truck", async () => {
    const [truck] = (await api(app, admin).post('/records/drivers', { first_name: 'A', last_name: 'B', truck_number: '7', type: 'company', dispatcher_id: d2Id })).body;
    const res = await api(app, admin).post('/records/loads', { load_number: 'A-1', total: 1, assigned_to: d1Id, driver_id: truck.id });
    expect(res.status).toBe(422);
  });

  it('dates: delivery not before pickup; dispatchers cannot set a past delivery date', async () => {
    expect((await api(app, admin).post('/records/loads', { load_number: 'D-1', total: 1, pickup_date: day(5), delivery_date: day(2) })).status).toBe(422);
    expect((await api(app, admin).post('/records/loads', { load_number: 'D-2', total: 1, pickup_date: day(-9), delivery_date: day(-5) })).status).toBe(201);
    const res = await api(app, d1).post('/records/loads', { load_number: 'D-3', total: 1, assigned_to: d1Id, delivery_date: day(-5) });
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Delivery date cannot be in the past.');
    expect((await api(app, admin).post('/records/loads', { load_number: 'D-4', total: 1, pickup_date: '2026-02-30' })).status).toBe(400);
  });

  it('status transitions are validated on the server', async () => {
    const load = await newLoad(admin, { load_number: 'S-1', total: 1 });
    expect((await api(app, admin).patch(`/records/loads?id=eq.${load.id}`, { status: 'delivered' })).status).toBe(200);
    const bad = await api(app, admin).patch(`/records/loads?id=eq.${load.id}`, { status: 'available' });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe('INVALID_STATUS_TRANSITION');
    expect((await api(app, admin).patch(`/records/loads?id=eq.${load.id}`, { status: 'shipped' })).status).toBe(400);
  });

  it('partials need an existing full parent; a parent with partials cannot be deleted', async () => {
    expect((await api(app, admin).post('/records/loads', { load_number: 'C-1', is_partial: true, parent_load_number: 'NOPE', total: 1 })).status).toBe(422);
    const parent = await newLoad(admin, { load_number: 'F-1', total: 100 });
    const child = await newLoad(admin, { load_number: 'C-1', is_partial: true, parent_load_number: 'F-1', total: 10 });
    expect((await api(app, admin).post('/records/loads', { load_number: 'C-2', is_partial: true, parent_load_number: 'C-1', total: 1 })).status).toBe(422);
    const del = await api(app, admin).del(`/records/loads?id=eq.${parent.id}`);
    expect(del.status).toBe(409);
    // Renaming the parent keeps the partial attached (FK ON UPDATE CASCADE).
    await api(app, admin).patch(`/records/loads?id=eq.${parent.id}`, { load_number: 'F-1B' });
    expect((await prisma.load.findUniqueOrThrow({ where: { id: child.id } })).parentLoadNumber).toBe('F-1B');
    // Deleting both together works (partials go first).
    expect((await api(app, admin).del(`/records/loads?id=in.(${parent.id},${child.id})`)).body).toHaveLength(2);
  });

  it('every load change writes history in the same transaction', async () => {
    const load = await newLoad(admin, { load_number: 'H-1', total: 5 });
    await api(app, admin).patch(`/records/loads?id=eq.${load.id}`, { status: 'pickedup' });
    const history = (await api(app, admin).get(`/records/load_history?select=*&load_id=eq.${load.id}&order=created_at.desc&limit=50`)).body;
    expect(history.map((h: { action: string }) => h.action)).toEqual(['UPDATE', 'INSERT']);
    expect(history[0].old_row.status).toBe('available');
    expect(history[0].new_row.status).toBe('pickedup');
    expect(history[0].actor_id).toBe(adminId);
  });

  it('bulk update is all-or-nothing', async () => {
    const a = await newLoad(admin, { load_number: 'B-1', total: 1 });
    const b = await newLoad(admin, { load_number: 'B-2', total: 1 });
    await api(app, admin).patch(`/records/loads?id=eq.${b.id}`, { status: 'delivered' });
    // B-2 is delivered → can't go to available, so the whole batch must fail and B-1 stays unchanged.
    const res = await api(app, admin).patch(`/records/loads?id=in.(${a.id},${b.id})`, { status: 'available', from_city: 'Nowhere' });
    expect(res.status).toBe(422);
    expect((await prisma.load.findUniqueOrThrow({ where: { id: a.id } })).fromCity).toBeNull();
    const ok = await api(app, admin).patch(`/records/loads?id=in.(${a.id},${b.id})`, { status: 'delivered' });
    expect(ok.body).toHaveLength(2);
  });

  it('PATCH/DELETE without an id filter are refused', async () => {
    expect((await api(app, admin).patch('/records/loads', { status: 'delivered' })).status).toBe(400);
    expect((await api(app, admin).del('/records/loads?status=eq.available')).status).toBe(400);
  });

  it('deleting a driver clears it from loads and records history', async () => {
    const [truck] = (await api(app, d1).post('/records/drivers', { first_name: 'A', last_name: 'B', truck_number: '7', type: 'company', dispatcher_id: d1Id })).body;
    const load = await newLoad(d1, { load_number: 'DR-1', total: 1, assigned_to: d1Id, driver_id: truck.id });
    expect((await api(app, d1).del(`/records/drivers?id=eq.${truck.id}`)).status).toBe(200);
    expect((await prisma.load.findUniqueOrThrow({ where: { id: load.id } })).driverId).toBeNull();
    expect(await prisma.loadHistory.count({ where: { loadId: load.id, action: 'UPDATE' } })).toBe(1);
  });

  it('list supports filters, sorting and pagination', async () => {
    for (let i = 1; i <= 5; i += 1) await newLoad(admin, { load_number: `PG-${i}`, total: i * 10, status: i % 2 ? 'available' : 'pickedup' });
    const page = await api(app, admin).get('/records/loads?order=load_number.asc&limit=2&offset=2');
    expect(page.body.map((l: { load_number: string }) => l.load_number)).toEqual(['PG-3', 'PG-4']);
    expect(page.headers['x-total-count']).toBe('5');
    expect((await api(app, admin).get('/records/loads?status=eq.pickedup')).body).toHaveLength(2);
    expect((await api(app, admin).get('/records/loads?load_number=ilike.*g-5*')).body).toHaveLength(1);
  });

  it('staff: last active admin is protected; per-dispatcher % is validated', async () => {
    const res = await api(app, admin).post('/staff/manage', { action: 'update', user_id: adminId, full_name: 'A', role: 'dispatcher', is_active: true });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('LAST_ADMIN');
    expect((await api(app, admin).post('/staff/manage', { action: 'update', user_id: d1Id, full_name: 'D1', role: 'dispatcher', is_active: true, full_pct: 150 })).status).toBe(400);
    const ok = await api(app, admin).post('/staff/manage', { action: 'update', user_id: d1Id, full_name: 'D1', role: 'dispatcher', is_active: true, full_pct: '5', partial_pct: 7.5 });
    expect(ok.body.profile).toEqual(expect.objectContaining({ full_pct: 5, partial_pct: 7.5 }));
    const cleared = await api(app, admin).post('/staff/manage', { action: 'update', user_id: d1Id, full_name: 'D1', role: 'dispatcher', is_active: true, full_pct: '', partial_pct: null });
    expect(cleared.body.profile).toEqual(expect.objectContaining({ full_pct: null, partial_pct: null }));
  });

  it('staff: invite creates a hashed account; duplicates are refused; admin can reset a password', async () => {
    const inv = await api(app, admin).post('/staff/manage', { action: 'invite', email: 'New@sds.local', full_name: 'New One', role: 'dispatcher', password: 'Temp-pass-1' });
    expect(inv.status).toBe(200);
    expect((await api(app, admin).post('/staff/manage', { action: 'invite', email: 'new@sds.local', full_name: 'X', role: 'dispatcher', password: 'Temp-pass-1' })).status).toBe(409);
    await login(app, 'new@sds.local', 'Temp-pass-1');
    await api(app, admin).post('/staff/manage', { action: 'update', user_id: inv.body.user_id, full_name: 'New One', role: 'dispatcher', is_active: true, new_password: 'Reset-pass-2' });
    await expect(login(app, 'new@sds.local', 'Temp-pass-1')).rejects.toThrow();
    await login(app, 'new@sds.local', 'Reset-pass-2');
  });

  it('account: changing login/password needs the current password; admins are notified without the password', async () => {
    expect((await api(app, d1).post('/account/update', { new_password: 'NewPass123', current_password: 'wrong' })).status).toBe(401);
    expect((await api(app, d1).post('/account/update', { email: 'admin@sds.local', current_password: 'Password123!' })).status).toBe(409);
    const ok = await api(app, d1).post('/account/update', { email: 'd1.new@sds.local', new_password: 'NewPass123', current_password: 'Password123!' });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.email).toBe('d1.new@sds.local');
    await login(app, 'd1.new@sds.local', 'NewPass123');
    const notices = (await api(app, admin).get('/records/admin_notices?select=*&order=created_at.desc')).body;
    expect(notices.map((n: { kind: string }) => n.kind).sort()).toEqual(['email_changed', 'password_changed']);
    expect(JSON.stringify(notices)).not.toContain('NewPass123');
    expect((await api(app, admin).del(`/records/admin_notices?id=eq.${notices[0].id}`)).status).toBe(200);
  });

  it('account: avatar must be an image data URL', async () => {
    expect((await api(app, d1).post('/account/update', { avatar_url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await api(app, d1).post('/account/update', { avatar_url: 'data:image/png;base64,AAAA' })).body.profile.avatar_url).toBe('data:image/png;base64,AAAA');
  });

  it('test data fill/clear only touches is_test rows', async () => {
    const mine = await newLoad(admin, { load_number: 'MINE-1', total: 1 });
    const filled = await api(app, admin).post('/dev/test-data', { action: 'fill' });
    expect(filled.status).toBe(200);
    expect(filled.body.loads).toBeGreaterThan(30);
    await login(app, 'aziz@sds.local', 'TestData2026!');
    await api(app, admin).post('/dev/test-data', { action: 'clear' });
    expect(await prisma.load.count()).toBe(1);
    expect((await prisma.load.findFirstOrThrow()).id).toBe(mine.id);
    expect(await prisma.user.count({ where: { email: 'aziz@sds.local' } })).toBe(0);
    void d2; void d2Id;
  });
});
