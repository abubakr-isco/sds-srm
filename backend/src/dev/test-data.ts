import { DriverType, LoadStatus, Prisma, Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth/password';
import { dayToDate } from '../common/dates';
import type { Db } from '../prisma.service';

// Sample data for local development. Every row carries is_test = true, so it can be removed
// again without touching records entered by hand. Ported from the former browser preview.
export const TEST_DISPATCHERS = [
  { email: 'aziz@sds.local', full_name: 'Aziz Rakhimov' },
  { email: 'bekzod@sds.local', full_name: 'Bekzod Tursunov' },
  { email: 'dilnoza@sds.local', full_name: 'Dilnoza Karimova' },
];
const TEST_DRIVERS: [string, string, string, DriverType][] = [
  ['John', 'Carter', '101', 'company'], ['Mike', 'Davis', '102', 'owner'], ['Ruslan', 'Aliev', '103', 'company'],
  ['Sardor', 'Nazarov', '201', 'company'], ['Kevin', 'Brown', '202', 'owner'], ['Timur', 'Saidov', '203', 'company'],
  ['Alex', 'Petrov', '301', 'owner'], ['Jamshid', 'Umarov', '302', 'company'],
  ['Chris', 'Miller', '401', 'company'], ['Oybek', 'Yusupov', '402', 'owner'],
  ['Daniel', 'White', '501', 'company'], ['Farrukh', 'Ergashev', '502', 'owner'],
];
const TEST_LANES: [string, string, number][] = [
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

export async function clearTestData(tx: Db) {
  const testUsers = (await tx.user.findMany({ where: { isTest: true }, select: { id: true } })).map((u) => u.id);
  const testLoads = (await tx.load.findMany({ where: { isTest: true }, select: { id: true } })).map((l) => l.id);
  // Partials first (their parent FK is RESTRICT). Hand-made partials of a test parent are kept with their parent.
  await tx.load.deleteMany({ where: { isTest: true, isPartial: true } });
  await tx.load.deleteMany({ where: { isTest: true, partials: { none: { isTest: false } } } });
  await tx.loadHistory.deleteMany({ where: { loadId: { in: testLoads } } });
  // Hand-made loads and drivers of removed test dispatchers go back to the pool.
  await tx.load.updateMany({ where: { assignedTo: { in: testUsers } }, data: { assignedTo: null } });
  await tx.driver.updateMany({ where: { dispatcherId: { in: testUsers } }, data: { dispatcherId: null } });
  await tx.driver.deleteMany({ where: { isTest: true } });
  await tx.calendarNote.deleteMany({ where: { isTest: true } });
  await tx.activityLog.deleteMany({ where: { isTest: true } });
  await tx.user.deleteMany({ where: { isTest: true } });
}

export async function fillTestData(tx: Db, actor: { id: string; email: string }, testPassword: string) {
  await clearTestData(tx);
  const iso = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];

  const dispatcherIds = (await tx.user.findMany({ where: { role: Role.dispatcher, isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })).map((u) => u.id);
  const passwordHash = await hashPassword(testPassword);
  for (const person of TEST_DISPATCHERS) {
    if (await tx.user.findUnique({ where: { email: person.email } })) continue;
    const u = await tx.user.create({ data: { email: person.email, fullName: person.full_name, role: Role.dispatcher, passwordHash, isTest: true } });
    dispatcherIds.push(u.id);
  }

  const drivers = TEST_DRIVERS.map(([first, last, truck, type], i) => ({
    id: randomUUID(), firstName: first, lastName: last, truckNumber: truck, type,
    dispatcherId: i < TEST_DRIVERS.length - 2 && dispatcherIds.length ? dispatcherIds[i % dispatcherIds.length] : null, isTest: true,
  }));
  await tx.driver.createMany({ data: drivers });

  const taken = new Set((await tx.load.findMany({ where: { loadNumber: { startsWith: 'TEST-' } }, select: { loadNumber: true } })).map((l) => l.loadNumber));
  let n = 1001;
  const nextNumber = () => { while (taken.has(`TEST-${n}`)) n += 1; const v = `TEST-${n}`; taken.add(v); n += 1; return v; };
  const full: Prisma.LoadCreateManyInput[] = [];
  const partials: Prisma.LoadCreateManyInput[] = [];
  for (let i = 0; i < 36; i += 1) {
    const driver = drivers[i % drivers.length];
    const pickupOffset = -42 + Math.floor(rand() * 49);
    const status: LoadStatus = pickupOffset > 0 ? 'available' : pickupOffset > -3 ? pick<LoadStatus>(['available', 'pickedup']) : (rand() < 0.9 ? 'delivered' : 'pickedup');
    const [from, to, base] = pick(TEST_LANES);
    const load: Prisma.LoadCreateManyInput = {
      loadNumber: nextNumber(), isPartial: false, driverId: driver.id, fromCity: from, toCity: to, status,
      pickupDate: dayToDate(iso(pickupOffset)), deliveryDate: dayToDate(iso(pickupOffset + 1 + Math.floor(rand() * 3))),
      total: new Prisma.Decimal(Math.round((base + rand() * 900) / 50) * 50), assignedTo: driver.dispatcherId, isTest: true,
    };
    full.push(load);
    if (i % 6 === 2) {
      partials.push({ ...load, loadNumber: nextNumber(), isPartial: true, parentLoadNumber: load.loadNumber,
        total: new Prisma.Decimal(Math.round((350 + rand() * 500) / 25) * 25) });
    }
  }
  await tx.load.createMany({ data: full });
  await tx.load.createMany({ data: partials });

  await tx.calendarNote.createMany({
    data: TEST_NOTES.map((text, i) => ({
      noteDate: dayToDate(iso(-10 + i * 3 - (i % 2)))!, noteText: text, isTest: true,
      createdBy: i % 3 === 0 || !dispatcherIds.length ? actor.id : dispatcherIds[i % dispatcherIds.length],
    })),
  });
  const loads = full.length + partials.length;
  await tx.activityLog.create({ data: { actionText: `Added test data: ${loads} loads, ${drivers.length} drivers, ${TEST_NOTES.length} notes`, userEmail: actor.email, userId: actor.id, isTest: true } });
  return { loads, drivers: drivers.length, notes: TEST_NOTES.length, dispatchers: TEST_DISPATCHERS.map((d) => d.email) };
}
