import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { sendConversationAudio } from '../src/modules/conversations/conversation-audio.js';

test('organizer player resolves to audio and forwards the requested byte range', async (t) => {
  const player = 'https://ec88f21f1accecf38e20095a9fe175.a5.environment.api.powerplatform.com/powerautomate/automations/direct/player';
  const mp3 = 'https://freedomholdingcorporation.crm11.dynamics.com/api/filedownload/example?a=1&b=2';
  const database = { conversation: { findUnique: async () => ({ audioUrl: player }) } };
  const request = globalThis.fetch;
  const upstream = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.href === player) return new Response('<audio><source src="' + mp3.replace('&', '&amp;') + '"></audio>', {
      headers: { 'Content-Type': 'text/html' },
    });
    assert.equal(url.href, mp3);
    assert.equal(options.headers.Range, 'bytes=0-2');
    return new Response('ID3', { status: 206, headers: { 'Content-Type': 'audio/mpeg', 'Content-Range': 'bytes 0-2/128' } });
  });
  const { default: express } = await import('express');
  const app = express();
  app.get('/audio', (req, res) => sendConversationAudio(database, 'test-id', req, res));
  const server = createServer(app).listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, 'listening');
  const response = await request('http://127.0.0.1:' + server.address().port + '/audio', { headers: { Range: 'bytes=0-2' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(response.headers.get('content-range'), 'bytes 0-2/128');
  assert.equal(await response.text(), 'ID3');
  assert.equal(upstream.mock.callCount(), 2);
});
