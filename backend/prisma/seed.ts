// Development seed: demo admin + dispatcher (credentials from .env) and sample test data.
// Refuses to run in production — use `npm run create-admin` there.
import '../src/load-env';
import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { fillTestData } from '../src/dev/test-data';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for the development seed (see .env.example).`);
  return v;
}

async function main() {
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('The demo seed must not run with NODE_ENV=production. Use `npm run create-admin` instead.');
  }
  const prisma = new PrismaClient();
  try {
    const accounts = [
      { email: required('SEED_ADMIN_EMAIL'), password: required('SEED_ADMIN_PASSWORD'), fullName: 'Test Administrator', role: Role.admin },
      { email: required('SEED_DISPATCHER_EMAIL'), password: required('SEED_DISPATCHER_PASSWORD'), fullName: 'Test Dispatcher', role: Role.dispatcher },
    ];
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, dispatcherName: 'Morgan Reyes' } });
    let admin = null;
    for (const a of accounts) {
      const email = a.email.trim().toLowerCase();
      const passwordHash = await hashPassword(a.password);
      const user = await prisma.user.upsert({
        where: { email },
        update: { passwordHash, isActive: true, role: a.role, failedLoginCount: 0, lockedUntil: null },
        create: { email, passwordHash, fullName: a.fullName, role: a.role },
      });
      if (a.role === Role.admin) admin = user;
      console.log(`Seeded ${a.role}: ${email}`);
    }
    const testPassword = required('TEST_DATA_PASSWORD');
    const result = await prisma.$transaction((tx) => fillTestData(tx, admin!, testPassword), { timeout: 60000 });
    console.log(`Sample data: ${result.loads} loads, ${result.drivers} drivers, ${result.notes} notes; test dispatchers ${result.dispatchers.join(', ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
