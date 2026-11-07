import { ApiError } from '../../middleware/api-error.js';
import { mockConversations } from './mock-conversations.js';

export function createConversationSource(config, fetchImplementation = fetch) {
  return async function loadConversations() {
    if (config.IMPORT_SOURCE === 'mock') return structuredClone(mockConversations);
    if (!config.ORGANIZER_API_URL) {
      throw new ApiError(503, 'IMPORT_NOT_CONFIGURED', 'Organizer API is not configured');
    }
    try {
      // Destination is exclusively server configuration; never take a URL from a request.
      // Redirects are forbidden so the configured origin cannot redirect into another network.
      const response = await fetchImplementation(config.ORGANIZER_API_URL, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(config.IMPORT_TIMEOUT_MS),
        headers: { Accept: 'application/json', ...(config.ORGANIZER_API_TOKEN ? { Authorization: `Bearer ${config.ORGANIZER_API_TOKEN}` } : {}) },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(502, 'UPSTREAM_ERROR', 'Organizer API request failed');
      }
      const declaredSize = Number(response.headers.get('content-length'));
      if (declaredSize > config.IMPORT_MAX_BYTES) {
        await response.body?.cancel();
        throw new ApiError(502, 'UPSTREAM_TOO_LARGE', 'Organizer API response is too large');
      }
      if (!response.body) throw new ApiError(502, 'UPSTREAM_INVALID_DATA', 'Organizer API returned invalid data');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > config.IMPORT_MAX_BYTES) {
            await reader.cancel();
            throw new ApiError(502, 'UPSTREAM_TOO_LARGE', 'Organizer API response is too large');
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!payload || !Array.isArray(payload.conversations) || payload.conversations.length > config.IMPORT_MAX_RECORDS) {
        throw new ApiError(502, 'UPSTREAM_INVALID_DATA', 'Organizer API returned invalid data');
      }
      return payload.conversations;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new ApiError(504, 'UPSTREAM_TIMEOUT', 'Organizer API timed out');
      }
      // Never expose upstream response bodies, error causes, private URL or token.
      throw new ApiError(502, 'UPSTREAM_ERROR', 'Organizer API request failed');
    }
  };
}
