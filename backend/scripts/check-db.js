import { prisma } from '../src/database/client.js';

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log('PostgreSQL connection: OK');
} catch {
  console.error('PostgreSQL connection failed. Check DATABASE_URL and database availability.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
