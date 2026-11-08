import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';

// ES module caching provides a single client/pool per application process.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

export const prisma = new PrismaClient({ adapter, log: ['warn'] });
