import { z } from 'zod';

export const aiConfigSchema = z.object({
  AI_MODE: z.enum(['http', 'mock']).default('http'),
  AI_BASE_URL: z.string().url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && !url.search && !url.hash && url.pathname === '/';
  }, 'AI_BASE_URL must be an HTTP(S) origin without credentials, path, query or fragment').default('http://localhost:8001'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1).max(100000).default(100000),
  AI_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().max(10485760).default(2097152),
  AI_SERVICE_KIND: z.enum(['ai', 'mock']).default('ai'),
  AI_ALLOW_MOCK_IN_PRODUCTION: z.enum(['true', 'false']).default('false'),
  AI_MOCK_SCENARIO: z.enum(['success', 'timeout', 'unavailable', 'invalid-json', 'bad-scale', 'false-quote', 'missing', 'duplicate', 'na']).default('success'),
});
