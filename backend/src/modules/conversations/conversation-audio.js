import { pipeline } from 'node:stream/promises';
import { ApiError } from '../../middleware/api-error.js';

const playerHost = 'ec88f21f1accecf38e20095a9fe175.a5.environment.api.powerplatform.com';
const fileHost = 'freedomholdingcorporation.crm11.dynamics.com';
const badSource = () => new ApiError(502, 'AUDIO_SOURCE_UNAVAILABLE', 'Organizer recording is unavailable');

function trustedUrl(raw, host, prefix) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.host !== host || url.username || url.password || !url.pathname.startsWith(prefix)) {
    throw badSource();
  }
  return url;
}

async function audioSource(raw, signal, range) {
  const player = trustedUrl(raw, playerHost, '/powerautomate/automations/direct/');
  const options = { signal, redirect: 'error' };
  const page = await fetch(player, options);
  if (!page.ok || !page.headers.get('content-type')?.startsWith('text/html')) throw badSource();
  const chunks = [];
  let size = 0;
  for await (const chunk of page.body) {
    size += chunk.length;
    if (size > 128 * 1024) throw badSource();
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString().match(/<source\b[^>]*?\s+src\s*=\s*(["'])([^"']+)\1/i);
  if (!source) throw badSource();
  const url = trustedUrl(source[2].replaceAll('&amp;', '&'), fileHost, '/api/filedownload/');
  return fetch(url, { ...options, headers: range ? { Range: range } : {} });
}

export async function sendConversationAudio(database, id, req, res) {
  const row = await database.conversation.findUnique({ where: { id }, select: { audioUrl: true } });
  if (!row?.audioUrl) throw new ApiError(404, 'AUDIO_NOT_FOUND', 'Conversation has no recording');
  const range = req.get('range');
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) throw new ApiError(416, 'INVALID_AUDIO_RANGE', 'Invalid byte range');
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once('close', abort);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
  try {
    const media = await audioSource(row.audioUrl, signal, range);
    if (media.status === 416) {
      const contentRange = media.headers.get('content-range');
      if (contentRange) res.set('Content-Range', contentRange);
      throw new ApiError(416, 'INVALID_AUDIO_RANGE', 'Requested range is outside recording');
    }
    if (![200, 206].includes(media.status) || !/^audio\/mpeg(?:\s*;|$)/i.test(media.headers.get('content-type') ?? '')) throw badSource();
    res.status(media.status).type('audio/mpeg').set('Cache-Control', 'private, no-store');
    for (const name of ['accept-ranges', 'content-length', 'content-range']) {
      const value = media.headers.get(name);
      if (value) res.set(name, value);
    }
    await pipeline(media.body, res, { signal });
  } catch (error) {
    if (res.destroyed) return;
    throw error instanceof ApiError ? error : badSource();
  } finally {
    res.off('close', abort);
    abort();
  }
}
