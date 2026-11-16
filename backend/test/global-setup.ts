import { execSync } from 'node:child_process';

// Applies migrations to the test database before the suite runs (never touches other databases).
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL || 'postgresql://sds:sds_local_password@localhost:5432/sds_crm_test?schema=public';
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run tests against "${dbName}": the database name must end in _test.`);
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
