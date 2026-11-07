import { ApiError } from '../middleware/api-error.js';
import { aiConfigSchema } from './ai-config.js';

export function createHttpAiClient(config, fetchImplementation = fetch) {
  config = aiConfigSchema.parse(config);
  const endpoint = new URL('/v1/evaluations', config.AI_BASE_URL).toString();
  return {
    source: config.AI_SERVICE_KIND === 'mock' ? 'mock' : 'ai', transport: 'http',
    async evaluate(request) {
      try {
        const response = await fetchImplementation(endpoint, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.AI_TIMEOUT_MS),
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(request),
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 504) throw new ApiError(504, 'AI_TIMEOUT', 'AI service timed out');
          if (response.status === 503) throw new ApiError(503, 'AI_UNAVAILABLE', 'AI service is unavailable');
          throw new ApiError(502, 'AI_HTTP_ERROR', 'AI service request failed');
        }
        if (Number(response.headers.get('content-length')) > config.AI_MAX_RESPONSE_BYTES) {
          await response.body?.cancel();
          throw new ApiError(502, 'AI_RESPONSE_TOO_LARGE', 'AI service response is too large');
        }
        if (!response.body) throw new ApiError(502, 'AI_INVALID_RESPONSE', 'AI service returned an invalid response');
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > config.AI_MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new ApiError(502, 'AI_RESPONSE_TOO_LARGE', 'AI service response is too large');
            }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new ApiError(502, 'AI_INVALID_JSON', 'AI service returned invalid JSON'); }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (['TimeoutError', 'AbortError'].includes(error?.name)) throw new ApiError(504, 'AI_TIMEOUT', 'AI service timed out');
        throw new ApiError(503, 'AI_UNAVAILABLE', 'AI service is unavailable');
      }
    },
  };
}
