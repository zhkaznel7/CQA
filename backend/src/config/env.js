import { z } from 'zod';
import { databaseUrl } from './database-url.js';

const positiveInteger = (defaultValue, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().positive().max(max).default(defaultValue);

const origin = z.string().url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
}, 'Use an exact HTTP(S) origin without a trailing slash');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  DATABASE_URL: z.string().url().refine((value) => {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname) && url.pathname.length > 1;
  }, 'Use a PostgreSQL connection URL with host and database'),
  PORT: positiveInteger(3000, 65535),
  CORS_ORIGINS: z.string()
    .default('http://localhost:5173,http://localhost:3000')
    .transform((value) => value.split(',').map((item) => item.trim()))
    .pipe(z.array(origin).min(1)),
  JSON_BODY_LIMIT: z.string().regex(/^[1-9]\d*(b|kb|mb)$/i).default('100kb'),
  RATE_LIMIT_WINDOW_MS: positiveInteger(60000, 2147483647),
  RATE_LIMIT_MAX: positiveInteger(100),
  IMPORT_SOURCE: z.enum(['mock', 'organizers']).default('mock'),
  ORGANIZER_API_URL: z.preprocess((value) => value === '' ? undefined : value,
    z.string().url().refine((value) => {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
    }, 'Organizer API must use HTTPS without URL credentials or fragment').optional()),
  ORGANIZER_API_TOKEN: z.string().max(4000).optional(),
  IMPORT_TIMEOUT_MS: positiveInteger(10000, 60000),
  IMPORT_MAX_BYTES: positiveInteger(2097152, 10485760),
  IMPORT_MAX_RECORDS: positiveInteger(500, 1000),
});

const result = schema.safeParse({ ...process.env, DATABASE_URL: databaseUrl() });

if (!result.success) {
  const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

export const env = result.data;
