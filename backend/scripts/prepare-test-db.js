import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseUrl } from '../src/config/database-url.js';

async function prepare() {
  let target;
  try {
    target = new URL(databaseUrl());
    if (!['postgresql:', 'postgres:'].includes(target.protocol)
      || decodeURIComponent(target.pathname.slice(1)) !== 'cqa_test') throw new Error();
  } catch {
    console.error('Set DATABASE_URL to the dedicated PostgreSQL database cqa_test. No changes made.');
    process.exitCode = 1;
    return;
  }

  // Connect to the maintenance DB, never to the application DB, to create cqa_test.
  const maintenance = new URL(target);
  maintenance.pathname = '/postgres';
  const admin = new PrismaClient({ adapter: new PrismaPg({
    connectionString: maintenance.toString(), max: 1, connectionTimeoutMillis: 5000,
  }) });
  try {
    const exists = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = 'cqa_test'`;
    if (exists.length) console.log('Test database cqa_test already exists; keeping its data.');
    else {
      try {
        // Fixed identifier; CREATE DATABASE must run outside a transaction.
        await admin.$executeRawUnsafe('CREATE DATABASE "cqa_test"');
        console.log('Created dedicated test database cqa_test.');
      } catch (error) {
        // Another preparation process may have created it after our existence check.
        const created = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = 'cqa_test'`;
        if (!created.length) throw error;
        console.log('Test database cqa_test now exists; keeping its data.');
      }
    }
  } catch {
    console.error('Could not prepare cqa_test. Check PostgreSQL, credentials and CREATEDB permission.');
    process.exitCode = 1;
    return;
  } finally {
    await admin.$disconnect();
  }

  console.log(`Applying migrations only to ${target.hostname}:${target.port || '5432'}/cqa_test.`);
  const migration = spawnSync(process.execPath, [
    fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)),
    'migrate', 'deploy',
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env: { ...process.env, DATABASE_URL: target.toString() },
    stdio: 'inherit',
  });
  if (migration.error) console.error('Could not start the installed Prisma CLI. Run npm.cmd ci first.');
  process.exitCode = migration.status ?? 1;
}

await prepare();
