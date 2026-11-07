import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';
import { databaseUrl } from './src/config/database-url.js';

if (existsSync('.env')) loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation and validation do not need a running database or a secret.
  datasource: { url: databaseUrl() ?? '' },
});
