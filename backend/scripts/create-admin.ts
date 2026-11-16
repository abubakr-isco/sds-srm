// Creates the first administrator (works in production). Reads ADMIN_EMAIL, ADMIN_FULL_NAME
// and ADMIN_PASSWORD from the environment; the password is never printed or logged.
//   ADMIN_EMAIL=boss@company.com ADMIN_FULL_NAME="Jane Doe" ADMIN_PASSWORD='…' npm run create-admin
import '../src/load-env';
import { PrismaClient, Role } from '@prisma/client';
import { hashPassword } from '../src/auth/password';

async function main() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const fullName = (process.env.ADMIN_FULL_NAME || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set ADMIN_EMAIL to a valid email.');
  if (!fullName) throw new Error('Set ADMIN_FULL_NAME.');
  if (password.length < 12) throw new Error('Set ADMIN_PASSWORD (at least 12 characters).');
  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email } })) throw new Error(`User ${email} already exists.`);
    await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await prisma.user.create({ data: { email, fullName, role: Role.admin, passwordHash: await hashPassword(password) } });
    console.log(`Administrator ${email} created.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
