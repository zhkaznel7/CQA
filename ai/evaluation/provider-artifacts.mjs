import {writeFileSync} from 'node:fs';
import path from 'node:path';

// Diagnostic bodies are private run artifacts, never the public API error or stderr.
// Keep the provider's field-level explanation so an HTTP 400 can be investigated offline.
export function saveProviderArtifact(outputDir, response, payload, key, conversationId = '') {
  if (conversationId && !/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw Error('Некорректный ID диагностического артефакта.');
  let safe = payload;
  for (const secret of new Set([key, key && encodeURIComponent(key)])) {
    if (secret) safe = safe.replaceAll(secret, '[REDACTED]');
  }
  safe = safe.replace(/AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{35,}/g, '[REDACTED]');
  const stem = response.ok ? 'provider-response' : 'provider-error';
  const name = stem + (conversationId ? '-' + conversationId : '') + '.json';
  writeFileSync(path.join(outputDir, '.run', name), safe, {mode: 0o600, flag: 'wx'});
}

export function recordingRequest({outputDir, key, conversationId, request = fetch, warn = console.warn}) {
  return async (url, init) => {
    const response = await request(url, init);
    return {status: response.status, ok: response.ok, headers: response.headers,
      text: async () => {
        const payload = await response.text();
        try {
          saveProviderArtifact(outputDir, response, payload, key, conversationId);
        } catch {
          // Google has already replied. A local diagnostic write failure must
          // not replace its HTTP status with a retryable network error.
          warn('Не удалось сохранить диагностическое тело ответа Google. HTTP ' + response.status + '.');
        }
        return payload;
      }};
  };
}
