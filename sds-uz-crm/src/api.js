// The production CRM talks only to its own server at /api. The browser-only
// preview below is compiled into Vite development mode and is not authentication.
const PREVIEW_KEY = 'sds_crm_preview_v1';
const ADMIN_ID = '10000000-0000-4000-8000-000000000001';
const DISPATCHER_ID = '10000000-0000-4000-8000-000000000002';
const now = () => new Date().toISOString();

function initialPreview() {
  return {
    staff_profiles: [
      { user_id: ADMIN_ID, email: 'admin@sds.local', full_name: 'Test Administrator', role: 'admin', is_active: true, created_at: now() },
      { user_id: DISPATCHER_ID, email: 'dispatcher@sds.local', full_name: 'Test Dispatcher', role: 'dispatcher', is_active: true, created_at: now() },
    ],
    settings: [{ id: 1, full_pct: 2, partial_pct: 3, dispatcher_name: 'Morgan Reyes', avatar_url: '', theme: 'dark' }],
    loads: [], drivers: [], custom_cities: [], calendar_notes: [], activity_log: [], load_history: [],
    admin_notices: [],
    credentials: defaultCredentials(),
  };
}
function defaultCredentials() {
  return {
    [ADMIN_ID]: { email: 'admin@sds.local', password: 'Admin2026!' },
    [DISPATCHER_ID]: { email: 'dispatcher@sds.local', password: 'Dispatch2026!' },
  };
}
// Older previews were saved before per-user credentials and admin notices existed.
function migratePreview(data) {
  if (!data.credentials) data.credentials = defaultCredentials();
  if (!Array.isArray(data.admin_notices)) data.admin_notices = [];
  return data;
}

function readPreview() {
  try {
    const stored = localStorage.getItem(PREVIEW_KEY);
    return stored ? migratePreview(JSON.parse(stored)) : initialPreview();
  } catch { return initialPreview(); }
}
function savePreview(data) { localStorage.setItem(PREVIEW_KEY, JSON.stringify(data)); }
function previewActor(token, data) {
  const id = typeof token === 'string' && token.startsWith('preview-') ? token.slice(8) : null;
  const actor = data.staff_profiles.find((person) => person.user_id === id && person.is_active);
  if (!actor) throw new Error('Sign in required or account inactive.');
  return actor;
}
function canRead(table, row, actor, data) {
  if (actor.role === 'admin') return true;
  if (table === 'loads') return !row.assigned_to || row.assigned_to === actor.user_id;
  if (table === 'load_history') {
    const load = data.loads.find((item) => String(item.id) === row.load_id);
    return !!load && (!load.assigned_to || load.assigned_to === actor.user_id);
  }
  if (table === 'activity_log') return row.user_id === actor.user_id;
  if (table === 'staff_profiles') return row.is_active;
  if (table === 'admin_notices') return false;
  if (table === 'drivers') return row.dispatcher_id === actor.user_id;
  return true;
}
function canWrite(table, action, row, next, actor, data) {
  if (table === 'staff_profiles' || table === 'load_history') return false;
  if (table === 'admin_notices') return actor.role === 'admin' && action !== 'insert';
  if (actor.role === 'admin') return true;
  if (table === 'loads') {
    if (action === 'insert') return next.assigned_to === actor.user_id;
    if (action === 'delete') return row?.assigned_to === actor.user_id;
    if ((!row?.assigned_to || row.assigned_to === actor.user_id) && next.assigned_to === actor.user_id) return true;
    // Hand-off: a dispatcher may transfer their own load to another dispatcher. Only the
    // dispatcher and truck change, and the truck is cleared (the receiver picks one of theirs).
    const changedKeys = Object.keys(next).filter((key) => next[key] !== row?.[key]);
    return row?.assigned_to === actor.user_id && !!next.assigned_to && next.assigned_to !== actor.user_id &&
      !next.driver_id && changedKeys.every((key) => ['assigned_to', 'driver_id'].includes(key));
  }
  if (table === 'settings') return false;
  if (table === 'activity_log') return action === 'insert' && next.user_id === actor.user_id;
  if (table === 'calendar_notes') return action === 'insert' ? next.created_by === actor.user_id : row?.created_by === actor.user_id;
  if (table === 'drivers') {
    if (action === 'insert') return next.dispatcher_id === actor.user_id;
    if (action === 'delete') return row?.dispatcher_id === actor.user_id;
    return row?.dispatcher_id === actor.user_id && next.dispatcher_id === actor.user_id;
  }
  return table === 'custom_cities';
}
// A load's truck must belong to the load's dispatcher. Dispatchers may only put
// their own drivers on loads; admins may not pair a load with another dispatcher's driver.
function checkLoadDriver(data, actor, before, next) {
  if (!next.driver_id) return;
  if (before && String(before.driver_id) === String(next.driver_id) && before.assigned_to === next.assigned_to) return;
  const driver = data.drivers.find((d) => String(d.id) === String(next.driver_id));
  if (!driver) throw new Error('Driver not found.');
  if (actor.role !== 'admin') {
    if (before && String(before.driver_id) === String(next.driver_id)) return;
    if (driver.dispatcher_id !== actor.user_id) throw new Error('You can only use your own drivers.');
    return;
  }
  if (next.assigned_to && driver.dispatcher_id && driver.dispatcher_id !== next.assigned_to) {
    throw new Error('This driver belongs to another dispatcher.');
  }
}
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// Delivery must not precede pickup; dispatchers cannot set a delivery date in the past.
function checkLoadDates(actor, before, next) {
  const deliveryChanged = !before || (before.delivery_date || null) !== (next.delivery_date || null);
  const pickupChanged = !before || (before.pickup_date || null) !== (next.pickup_date || null);
  if (!next.delivery_date || (!deliveryChanged && !pickupChanged)) return;
  if (next.pickup_date && next.delivery_date < next.pickup_date) throw new Error('Delivery date cannot be earlier than pickup date.');
  if (actor.role !== 'admin' && deliveryChanged && next.delivery_date < localToday()) throw new Error('Delivery date cannot be in the past.');
}
function checkDriverDispatcher(data, row) {
  if (row.dispatcher_id && !data.staff_profiles.some((p) => p.user_id === row.dispatcher_id && p.role === 'dispatcher' && p.is_active)) {
    throw new Error('Invalid dispatcher.');
  }
}
// ---------------------------------------------------------------------------
// Local preview test data. Every seeded row carries is_test: true so it can be
// removed again without touching anything entered by hand.
// ---------------------------------------------------------------------------
const TEST_DISPATCHERS = [
  { email: 'aziz@sds.local', full_name: 'Aziz Rakhimov' },
  { email: 'bekzod@sds.local', full_name: 'Bekzod Tursunov' },
  { email: 'dilnoza@sds.local', full_name: 'Dilnoza Karimova' },
];
export const TEST_PASSWORD = 'Test2026!';
const TEST_DRIVERS = [
  ['John', 'Carter', '101', 'company'], ['Mike', 'Davis', '102', 'owner'], ['Ruslan', 'Aliev', '103', 'company'],
  ['Sardor', 'Nazarov', '201', 'company'], ['Kevin', 'Brown', '202', 'owner'], ['Timur', 'Saidov', '203', 'company'],
  ['Alex', 'Petrov', '301', 'owner'], ['Jamshid', 'Umarov', '302', 'company'],
  ['Chris', 'Miller', '401', 'company'], ['Oybek', 'Yusupov', '402', 'owner'],
  ['Daniel', 'White', '501', 'company'], ['Farrukh', 'Ergashev', '502', 'owner'],
];
const TEST_LANES = [
  ['Chicago, IL', 'Dallas, TX', 2900], ['Atlanta, GA', 'Miami, FL', 1800], ['Los Angeles, CA', 'Phoenix, AZ', 1500],
  ['Houston, TX', 'Memphis, TN', 2100], ['Newark, NJ', 'Columbus, OH', 1900], ['Denver, CO', 'Salt Lake City, UT', 1700],
  ['Buffalo, NY', 'New York, NY', 1400], ['Seattle, WA', 'Portland, OR', 1100], ['Nashville, TN', 'Charlotte, NC', 1600],
  ['Kansas City, MO', 'Omaha, NE', 1250], ['Indianapolis, IN', 'Detroit, MI', 1350], ['Laredo, TX', 'Oklahoma City, OK', 2400],
];
const TEST_NOTES = [
  'Call broker about rate confirmation', 'Truck 102 — oil change at 9:00', 'Weekly settlement with owner operators',
  'Driver 203 off duty (home time)', 'Check insurance renewal for truck 301', 'Team meeting 10:00',
  'Follow up on detention pay for load TEST-1007', 'New driver orientation', 'IFTA report due', 'Pay fuel card invoice',
];

function clearTestData(data) {
  const testUsers = new Set(data.staff_profiles.filter((p) => p.is_test).map((p) => p.user_id));
  for (const table of ['loads', 'drivers', 'calendar_notes', 'activity_log']) {
    data[table] = data[table].filter((row) => !row.is_test);
  }
  data.load_history = data.load_history.filter((row) => data.loads.some((l) => String(l.id) === row.load_id));
  data.staff_profiles = data.staff_profiles.filter((p) => !p.is_test);
  testUsers.forEach((id) => { delete data.credentials[id]; });
  // Hand-made loads that were assigned to a removed test dispatcher go back to the pool.
  data.loads.forEach((l) => { if (testUsers.has(l.assigned_to)) l.assigned_to = null; });
  data.drivers.forEach((d) => { if (testUsers.has(d.dispatcher_id)) d.dispatcher_id = null; });
}

function fillTestData(data, actor) {
  clearTestData(data);
  const iso = (offset) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = (list) => list[Math.floor(rand() * list.length)];

  // Dispatchers: every active dispatcher (including ones created by hand) plus the
  // test ones that do not exist yet. Trucks and loads are shared out among all of them.
  const dispatcherIds = data.staff_profiles.filter((p) => p.role === 'dispatcher' && p.is_active).map((p) => p.user_id);
  for (const person of TEST_DISPATCHERS) {
    if (Object.values(data.credentials).some((c) => c.email === person.email)) continue;
    const userId = crypto.randomUUID();
    data.staff_profiles.push({ user_id: userId, email: person.email, full_name: person.full_name, role: 'dispatcher', is_active: true, created_at: now(), is_test: true });
    data.credentials[userId] = { email: person.email, password: TEST_PASSWORD };
    dispatcherIds.push(userId);
  }

  // Drivers: two or three per dispatcher, the last two stay unassigned (for pool loads).
  const drivers = TEST_DRIVERS.map(([first, last, truck, type], i) => {
    const owner = i < TEST_DRIVERS.length - 2 && dispatcherIds.length ? dispatcherIds[i % dispatcherIds.length] : null;
    return { id: crypto.randomUUID(), first_name: first, last_name: last, truck_number: truck, type, dispatcher_id: owner, created_at: now(), is_test: true };
  });
  data.drivers.push(...drivers);

  // Loads spread over the last ~6 weeks and the next week.
  let n = 1001;
  const loads = [];
  for (let i = 0; i < 36; i += 1) {
    const driver = drivers[i % drivers.length];
    const pickupOffset = -42 + Math.floor(rand() * 49);
    const pickup = iso(pickupOffset);
    const delivery = iso(pickupOffset + 1 + Math.floor(rand() * 3));
    const status = pickupOffset > 0 ? 'available' : pickupOffset > -3 ? pick(['available', 'pickedup']) : (rand() < 0.9 ? 'delivered' : 'pickedup');
    const [from, to, base] = pick(TEST_LANES);
    const load = {
      id: crypto.randomUUID(), load_number: `TEST-${n++}`, is_partial: false, parent_load_number: null,
      driver_id: driver.id, from_city: from, to_city: to, status, pickup_date: pickup, delivery_date: delivery,
      total: Math.round((base + rand() * 900) / 50) * 50, assigned_to: driver.dispatcher_id, created_at: now(), is_test: true,
    };
    loads.push(load);
    // Every sixth load gets a partial on the same truck.
    if (i % 6 === 2) {
      loads.push({ ...load, id: crypto.randomUUID(), load_number: `TEST-${n++}`, is_partial: true, parent_load_number: load.load_number,
        total: Math.round((350 + rand() * 500) / 25) * 25 });
    }
  }
  data.loads.push(...loads);

  // Calendar notes around today.
  TEST_NOTES.forEach((text, i) => {
    data.calendar_notes.push({ id: crypto.randomUUID(), note_date: iso(-10 + i * 3 - (i % 2)), note_text: text,
      created_by: i % 3 === 0 ? actor.user_id : dispatcherIds[i % dispatcherIds.length], created_at: now(), is_test: true });
  });
  data.activity_log.push({ id: crypto.randomUUID(), action_text: `Added test data: ${loads.length} loads, ${drivers.length} drivers, ${TEST_NOTES.length} notes`,
    user_email: actor.email, user_id: actor.user_id, created_at: now(), is_test: true });
  return { loads: loads.length, drivers: drivers.length, notes: TEST_NOTES.length, dispatchers: TEST_DISPATCHERS.map((d) => d.email) };
}

function matches(row, params) {
  for (const [key, value] of params.entries()) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    if (value.startsWith('eq.') && String(row[key] ?? '') !== value.slice(3)) return false;
    if (value.startsWith('in.(') && !value.slice(4, -1).split(',').includes(String(row[key]))) return false;
  }
  return true;
}
function audit(data, oldRow, newRow, action, actor) {
  data.load_history.push({
    id: data.load_history.length + 1,
    load_id: String(newRow?.id || oldRow?.id), action,
    actor_id: actor.user_id, old_row: oldRow || null, new_row: newRow || null,
    created_at: now(),
  });
}

// The preview fills itself with test data once, while it still has no loads.
// "Remove test data" is not undone afterwards because the flag stays set.
const AUTO_SEED_KEY = 'sds_crm_preview_autoseed_v3';
function autoSeed(data) {
  try { if (localStorage.getItem(AUTO_SEED_KEY)) return; } catch { return; }
  const admin = data.staff_profiles.find((p) => p.role === 'admin' && p.is_active);
  // Add (or rebuild) test data next to hand-made records, unless the admin removed it on purpose.
  if (admin && !data.test_data_removed) { fillTestData(data, admin); savePreview(data); }
  try { localStorage.setItem(AUTO_SEED_KEY, 'done'); } catch { /* ignore */ }
}

async function previewRequest(path, { method = 'GET', body, accessToken } = {}) {
  const data = readPreview();
  autoSeed(data);
  if (path === '/auth/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const userId = Object.keys(data.credentials).find((id) =>
      data.credentials[id].email === email && data.credentials[id].password === body.password);
    const user = userId ? data.staff_profiles.find((p) => p.user_id === userId) : null;
    if (!user && TEST_DISPATCHERS.some((d) => d.email === email) && !Object.values(data.credentials).some((c) => c.email === email)) {
      throw new Error('This test account does not exist yet. Sign in as admin and click Settings → Fill test data first.');
    }
    if (!user?.is_active) throw new Error('Invalid credentials or account inactive.');
    return { access_token: `preview-${user.user_id}`,
      refresh_token: user.user_id, user: { id: user.user_id, email: user.email } };
  }
  if (path === '/auth/refresh' && method === 'POST') {
    const user = data.staff_profiles.find((p) => p.user_id === body.refresh_token && p.is_active);
    if (!user) throw new Error('Session expired.');
    return { access_token: `preview-${user.user_id}`, refresh_token: user.user_id };
  }
  const actor = previewActor(accessToken, data);
  if (path === '/dev/test-data' && method === 'POST') {
    if (actor.role !== 'admin') throw new Error('Administrator access required.');
    const result = body.action === 'clear' ? (clearTestData(data), { cleared: true }) : fillTestData(data, actor);
    data.test_data_removed = body.action === 'clear';
    savePreview(data);
    return result;
  }
  if (path === '/account/update' && method === 'POST') {
    const creds = data.credentials[actor.user_id];
    const email = body.email === undefined ? creds.email : String(body.email).trim().toLowerCase();
    const newPassword = body.new_password ? String(body.new_password) : '';
    const changesLogin = email !== creds.email || !!newPassword;
    if (changesLogin && body.current_password !== creds.password) throw new Error('Current password is incorrect.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email.');
    if (email !== creds.email && Object.values(data.credentials).some((c) => c.email === email)) throw new Error('This email is already in use.');
    if (newPassword && newPassword.length < 8) throw new Error('Password must be at least 8 characters.');
    if (body.avatar_url !== undefined && body.avatar_url !== '' && !String(body.avatar_url).startsWith('data:image/')) throw new Error('Invalid image.');
    if (body.avatar_url !== undefined && String(body.avatar_url).length > 1_500_000) throw new Error('Image is too large (max ~1 MB).');
    const profile = data.staff_profiles.find((p) => p.user_id === actor.user_id);
    if (body.avatar_url !== undefined) profile.avatar_url = body.avatar_url;
    if (email !== creds.email) {
      data.admin_notices.push({ id: crypto.randomUUID(), kind: 'email_changed', user_id: actor.user_id,
        full_name: profile.full_name, old_email: creds.email, new_email: email, new_password: null, created_at: now() });
      profile.email = email; creds.email = email;
    }
    if (newPassword) {
      creds.password = newPassword;
      // Requested business rule: the administrator receives the dispatcher's new password.
      if (actor.role !== 'admin') {
        data.admin_notices.push({ id: crypto.randomUUID(), kind: 'password_changed', user_id: actor.user_id,
          full_name: profile.full_name, old_email: null, new_email: email, new_password: newPassword, created_at: now() });
      }
    }
    savePreview(data);
    return { profile };
  }
  if (path === '/staff/manage' && method === 'POST') {
    if (actor.role !== 'admin') throw new Error('Administrator access required.');
    if (body.action === 'invite') {
      const email = String(body.email || '').trim().toLowerCase();
      const fullName = String(body.full_name || '').trim();
      const password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email.');
      if (!fullName) throw new Error('Enter a full name.');
      if (!['admin', 'dispatcher'].includes(body.role)) throw new Error('Invalid role.');
      if (password.length < 8) throw new Error('Temporary password must be at least 8 characters.');
      if (Object.values(data.credentials).some((c) => c.email === email)) throw new Error('This email is already in use.');
      const userId = crypto.randomUUID();
      data.staff_profiles.push({ user_id: userId, email, full_name: fullName, role: body.role, is_active: true, created_at: now() });
      data.credentials[userId] = { email, password };
      savePreview(data);
      return { invited: true, user_id: userId };
    }
    if (body.action !== 'update') throw new Error('Unknown staff action.');
    const target = data.staff_profiles.find((p) => p.user_id === body.user_id);
    if (!target) throw new Error('Employee not found.');
    if (!['admin', 'dispatcher'].includes(body.role) || typeof body.is_active !== 'boolean' || !String(body.full_name || '').trim()) throw new Error('Invalid employee data.');
    if (target.role === 'admin' && target.is_active && (body.role !== 'admin' || !body.is_active) &&
      data.staff_profiles.filter((p) => p.role === 'admin' && p.is_active).length === 1) throw new Error('Cannot remove the last active administrator.');
    Object.assign(target, { full_name: String(body.full_name || '').trim(), role: body.role, is_active: body.is_active });
    savePreview(data);
    return { updated: true };
  }
  const endpoint = new URL(path, 'http://localhost');
  const table = endpoint.pathname.match(/^\/records\/([a-z_]+)$/)?.[1];
  if (!table || !Array.isArray(data[table])) throw new Error('Unknown API resource.');
  const rows = data[table];
  const selected = rows.filter((row) => matches(row, endpoint.searchParams) && canRead(table, row, actor, data));
  if (method === 'GET') {
    const order = endpoint.searchParams.get('order');
    if (order) {
      const [column, direction] = order.split('.');
      selected.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (direction === 'desc' ? -1 : 1));
    }
    const limit = Number(endpoint.searchParams.get('limit'));
    return limit > 0 ? selected.slice(0, limit) : selected;
  }
  if (method === 'POST') {
    const row = { ...body, id: body.id ?? crypto.randomUUID(), created_at: now() };
    if (!canWrite(table, 'insert', null, row, actor, data)) throw new Error('Permission denied.');
    if (table === 'loads' && row.assigned_to && !data.staff_profiles.some((p) => p.user_id === row.assigned_to && p.role === 'dispatcher' && p.is_active)) throw new Error('Invalid dispatcher.');
    if (table === 'loads') { checkLoadDriver(data, actor, null, row); checkLoadDates(actor, null, row); }
    if (table === 'drivers') checkDriverDispatcher(data, row);
    rows.push(row);
    if (table === 'loads') audit(data, null, row, 'INSERT', actor);
    savePreview(data);
    return [row];
  }
  const changed = [];
  for (const row of selected) {
    const next = { ...row, ...body };
    if (!canWrite(table, method === 'DELETE' ? 'delete' : 'update', row, next, actor, data)) continue;
    if (method === 'PATCH' && table === 'loads' && next.assigned_to &&
      !data.staff_profiles.some((p) => p.user_id === next.assigned_to && p.role === 'dispatcher' && p.is_active)) throw new Error('Invalid dispatcher.');
    if (method === 'PATCH' && table === 'loads') { checkLoadDriver(data, actor, row, next); checkLoadDates(actor, row, next); }
    if (method === 'PATCH' && table === 'drivers') checkDriverDispatcher(data, next);
    if (method === 'PATCH') {
      const before = { ...row };
      Object.assign(row, body);
      if (table === 'loads') audit(data, before, row, 'UPDATE', actor);
      changed.push(row);
    } else if (method === 'DELETE') {
      rows.splice(rows.indexOf(row), 1);
      if (table === 'loads') audit(data, row, null, 'DELETE', actor);
      changed.push(row);
    }
  }
  savePreview(data);
  return changed;
}

export async function apiRequest(path, options = {}) {
  if (import.meta.env.DEV) return previewRequest(path, options);
  const headers = { 'Content-Type': 'application/json' };
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || error.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return null;
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('CRM server is not connected yet.');
  }
  return response.json();
}

export const apiTable = (table, accessToken) => ({
  list: (query = '') => apiRequest(`/records/${table}?${query}`, { accessToken }),
  insert: (row) => apiRequest(`/records/${table}`, { method: 'POST', body: row, accessToken }),
  update: (id, row) => apiRequest(`/records/${table}?id=eq.${id}`, { method: 'PATCH', body: row, accessToken }),
  remove: (id) => apiRequest(`/records/${table}?id=eq.${id}`, { method: 'DELETE', accessToken }),
});
export const authSignIn = (email, password) => apiRequest('/auth/login', { method: 'POST', body: { email, password } });
export const updateAccount = (accessToken, changes) => apiRequest('/account/update', { method: 'POST', body: changes, accessToken });
export const authRefresh = (refreshToken) => apiRequest('/auth/refresh', { method: 'POST', body: { refresh_token: refreshToken } });
