import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

test('local preview dispatcher can claim a load but cannot edit settings or staff', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  values.set('sds_crm_preview_autoseed_v3', 'done'); // this test builds its own data
  const source = await readFile(new URL('./src/api.js', import.meta.url), 'utf8');
  const compiled = await build({
    stdin: { contents: source, sourcefile: 'api.js', loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { 'import.meta.env': JSON.stringify({ VITE_DEMO: '1', DEV: true }) },
  });
  const { apiRequest, apiTable, authSignIn, updateAccount } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

  await assert.rejects(authSignIn('dispatcher@sds.local', 'wrong-password'));
  const admin = await authSignIn('admin@sds.local', 'Admin2026!');
  const dispatcher = await authSignIn('dispatcher@sds.local', 'Dispatch2026!');
  const adminLoads = apiTable('loads', admin.access_token);
  const dispatcherLoads = apiTable('loads', dispatcher.access_token);
  const [pool] = await adminLoads.insert({ load_number: 'LOCAL-TEST-1', assigned_to: null, status: 'available', total: 100 });
  assert.equal((await dispatcherLoads.list()).length, 1);
  const [claimed] = await dispatcherLoads.update(pool.id, { assigned_to: dispatcher.user.id });
  assert.equal(claimed.assigned_to, dispatcher.user.id);
  assert.equal((await apiTable('load_history', dispatcher.access_token).list()).length, 2);

  const deniedSettings = await apiTable('settings', dispatcher.access_token).update(1, { full_pct: 99 });
  assert.deepEqual(deniedSettings, []);
  assert.equal((await apiTable('settings', admin.access_token).list())[0].full_pct, 2);
  await assert.rejects(apiRequest('/staff/manage', {
    method: 'POST', accessToken: dispatcher.access_token,
    body: { action: 'update', user_id: admin.user.id, full_name: 'Changed', role: 'dispatcher', is_active: false },
  }));

  // Dispatcher account settings: avatar, login and password; admin receives the new password.
  await assert.rejects(updateAccount(dispatcher.access_token, { new_password: 'NewPass123', current_password: 'wrong' }));
  await assert.rejects(updateAccount(dispatcher.access_token, { email: 'admin@sds.local', current_password: 'Dispatch2026!' }));
  await updateAccount(dispatcher.access_token, { avatar_url: 'data:image/png;base64,AAAA' });
  await updateAccount(dispatcher.access_token, {
    email: 'new.dispatcher@sds.local', new_password: 'NewPass123', current_password: 'Dispatch2026!',
  });
  await assert.rejects(authSignIn('dispatcher@sds.local', 'Dispatch2026!'));
  const relogged = await authSignIn('new.dispatcher@sds.local', 'NewPass123');
  const [me] = await apiTable('staff_profiles', relogged.access_token).list(`user_id=eq.${relogged.user.id}`);
  assert.equal(me.avatar_url, 'data:image/png;base64,AAAA');
  assert.equal(me.email, 'new.dispatcher@sds.local');
  assert.deepEqual(await apiTable('admin_notices', relogged.access_token).list(), []);
  const notices = await apiTable('admin_notices', admin.access_token).list();
  assert.equal(notices.find((n) => n.kind === 'password_changed').new_password, 'NewPass123');
  assert.ok(notices.some((n) => n.kind === 'email_changed' && n.new_email === 'new.dispatcher@sds.local'));

  // Drivers belong to a dispatcher; dispatchers see and use only their own trucks.
  const DISPATCHER_ID = relogged.user.id;
  const adminDrivers = apiTable('drivers', admin.access_token);
  const myDriversApi = apiTable('drivers', relogged.access_token);
  const [mine] = await adminDrivers.insert({ first_name: 'Mine', last_name: 'A', truck_number: 'T1', type: 'company', dispatcher_id: DISPATCHER_ID });
  const [unassigned] = await adminDrivers.insert({ first_name: 'Other', last_name: 'B', truck_number: 'T2', type: 'company', dispatcher_id: null });
  const [own] = await myDriversApi.insert({ first_name: 'Own', last_name: 'C', truck_number: 'T3', type: 'owner', dispatcher_id: DISPATCHER_ID });
  await assert.rejects(myDriversApi.insert({ first_name: 'X', last_name: 'Y', type: 'company', dispatcher_id: null }));
  assert.deepEqual((await myDriversApi.list()).map((d) => d.id).sort(), [mine.id, own.id].sort());
  assert.equal((await adminDrivers.list()).length, 3);
  assert.deepEqual(await myDriversApi.update(unassigned.id, { first_name: 'Hacked', dispatcher_id: DISPATCHER_ID }), []);

  const myLoads = apiTable('loads', relogged.access_token);
  await assert.rejects(myLoads.insert({ load_number: 'L-2', assigned_to: DISPATCHER_ID, driver_id: unassigned.id, total: 10 }), /own drivers/);
  const [load2] = await myLoads.insert({ load_number: 'L-3', assigned_to: DISPATCHER_ID, driver_id: mine.id, total: 10 });
  await assert.rejects(myLoads.update(load2.id, { driver_id: unassigned.id, assigned_to: DISPATCHER_ID }), /own drivers/);
  assert.equal((await myLoads.update(load2.id, { status: 'delivered', assigned_to: DISPATCHER_ID }))[0].status, 'delivered');
  // Admin cannot give a truck to a non-dispatcher, and the dispatcher now sees the newly assigned truck.
  await assert.rejects(adminDrivers.update(unassigned.id, { dispatcher_id: admin.user.id }), /Invalid dispatcher/);
  await adminDrivers.update(unassigned.id, { dispatcher_id: DISPATCHER_ID });
  assert.equal((await myDriversApi.list()).length, 3);

  // Dispatchers cannot backdate delivery; an existing past date survives unrelated edits.
  const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  await assert.rejects(myLoads.insert({ load_number: 'D-1', assigned_to: DISPATCHER_ID, driver_id: mine.id, delivery_date: iso(-1), total: 1 }), /in the past/);
  await assert.rejects(myLoads.insert({ load_number: 'D-2', assigned_to: DISPATCHER_ID, driver_id: mine.id, pickup_date: iso(3), delivery_date: iso(2), total: 1 }), /earlier than pickup/);
  const [dated] = await myLoads.insert({ load_number: 'D-3', assigned_to: DISPATCHER_ID, driver_id: mine.id, delivery_date: iso(0), total: 1 });
  await assert.rejects(myLoads.update(dated.id, { delivery_date: iso(-5), assigned_to: DISPATCHER_ID }), /in the past/);
  const [adminDated] = await adminLoads.update(dated.id, { delivery_date: iso(-5) });
  assert.equal(adminDated.delivery_date, iso(-5));
  assert.equal((await myLoads.update(dated.id, { status: 'delivered', assigned_to: DISPATCHER_ID }))[0].status, 'delivered');

  // Admin can create another administrator in the preview; dispatchers cannot.
  const invite = { action: 'invite', email: 'boss@sds.local', full_name: 'Second Admin', role: 'admin', password: 'Boss2026!' };
  await assert.rejects(apiRequest('/staff/manage', { method: 'POST', accessToken: relogged.access_token, body: invite }));
  await apiRequest('/staff/manage', { method: 'POST', accessToken: admin.access_token, body: invite });
  await assert.rejects(apiRequest('/staff/manage', { method: 'POST', accessToken: admin.access_token, body: invite }), /already in use/);
  const boss = await authSignIn('boss@sds.local', 'Boss2026!');
  const [bossProfile] = await apiTable('staff_profiles', boss.access_token).list(`user_id=eq.${boss.user.id}`);
  assert.equal(bossProfile.role, 'admin');

  // Transfer a load between dispatchers.
  await apiRequest('/staff/manage', { method: 'POST', accessToken: admin.access_token,
    body: { action: 'invite', email: 'second@sds.local', full_name: 'Second Dispatcher', role: 'dispatcher', password: 'Second2026!' } });
  const second = await authSignIn('second@sds.local', 'Second2026!');
  const secondLoads = apiTable('loads', second.access_token);
  const [handoff] = await myLoads.insert({ load_number: 'T-1', assigned_to: DISPATCHER_ID, driver_id: mine.id, total: 5 });
  // Dispatcher cannot hand off while keeping their own truck, or change other fields at the same time.
  assert.deepEqual(await myLoads.update(handoff.id, { assigned_to: second.user.id }), []);
  assert.deepEqual(await myLoads.update(handoff.id, { assigned_to: second.user.id, driver_id: null, total: 999 }), []);
  const [moved] = await myLoads.update(handoff.id, { assigned_to: second.user.id, driver_id: null });
  assert.equal(moved.assigned_to, second.user.id);
  assert.equal(moved.driver_id, null);
  assert.ok(!(await myLoads.list()).some((l) => l.id === handoff.id));
  assert.ok((await secondLoads.list()).some((l) => l.id === handoff.id));
  // Second dispatcher cannot transfer someone else's load; admin can transfer with the receiver's truck.
  const [handoff2] = await myLoads.insert({ load_number: 'T-2', assigned_to: DISPATCHER_ID, driver_id: mine.id, total: 5 });
  assert.deepEqual(await secondLoads.update(handoff2.id, { assigned_to: second.user.id, driver_id: null }), []);
  const [secondTruck] = await adminDrivers.insert({ first_name: 'S', last_name: 'T', truck_number: 'T9', type: 'company', dispatcher_id: second.user.id });
  await assert.rejects(adminLoads.update(handoff2.id, { assigned_to: second.user.id }), /another dispatcher/);
  const [adminMoved] = await adminLoads.update(handoff2.id, { assigned_to: second.user.id, driver_id: secondTruck.id });
  assert.equal(adminMoved.driver_id, secondTruck.id);

  // Test data: admin-only fill and clear that leaves hand-made records alone.
  const handMade = (await adminLoads.list()).length;
  await assert.rejects(apiRequest('/dev/test-data', { method: 'POST', accessToken: second.access_token, body: { action: 'fill' } }));
  const filled = await apiRequest('/dev/test-data', { method: 'POST', accessToken: admin.access_token, body: { action: 'fill' } });
  assert.ok(filled.loads >= 36);
  const all = await adminLoads.list();
  assert.equal(all.length, handMade + filled.loads);
  for (const l of all.filter((x) => x.is_test)) {
    assert.ok(l.delivery_date >= l.pickup_date);
    const d = (await adminDrivers.list()).find((x) => x.id === l.driver_id);
    assert.ok(!l.assigned_to || d.dispatcher_id === l.assigned_to);
  }
  assert.ok((await apiTable('calendar_notes', admin.access_token).list()).length >= 10);
  const aziz = await authSignIn('aziz@sds.local', 'Test2026!');
  assert.ok((await apiTable('drivers', aziz.access_token).list()).length > 0);
  // Hand-made dispatchers (here "second") also receive test trucks and loads.
  assert.ok((await apiTable('drivers', second.access_token).list()).some((d) => d.is_test));
  assert.ok((await secondLoads.list()).some((l) => l.is_test && l.assigned_to === second.user.id));
  await apiRequest('/dev/test-data', { method: 'POST', accessToken: admin.access_token, body: { action: 'fill' } });
  assert.equal((await adminLoads.list()).length, handMade + filled.loads);
  await apiRequest('/dev/test-data', { method: 'POST', accessToken: admin.access_token, body: { action: 'clear' } });
  assert.equal((await adminLoads.list()).length, handMade);
  await assert.rejects(authSignIn('aziz@sds.local', 'Test2026!'));
});

test('empty local preview fills itself with test loads once', async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const source = await readFile(new URL('./src/api.js', import.meta.url), 'utf8');
  const compiled = await build({
    stdin: { contents: source, sourcefile: 'api.js', loader: 'js' },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    define: { 'import.meta.env': JSON.stringify({ VITE_DEMO: '1', DEV: true }) },
  });
  const { apiRequest, apiTable, authSignIn } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const admin = await authSignIn('admin@sds.local', 'Admin2026!');
  const loads = await apiTable('loads', admin.access_token).list();
  assert.ok(loads.length >= 36);
  await apiRequest('/dev/test-data', { method: 'POST', accessToken: admin.access_token, body: { action: 'clear' } });
  assert.equal((await apiTable('loads', admin.access_token).list()).length, 0);
});
