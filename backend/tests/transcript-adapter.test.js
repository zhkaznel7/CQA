import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { toAiTranscript } from '../src/ai-client/transcript-adapter.js';
import { buildAiRequest } from '../src/modules/evaluations/ai-contract.js';
import { createAiClient } from '../src/ai-client/index.js';

const turn = { turnIndex: 0, speaker: 'operator', text: 'Synthetic transcript', timestamp: '00:05' };
const code = (expected) => (error) => error.status === 422 && error.code === expected;

test('organizer MM:SS and seven-digit ISO timestamps are preserved byte for byte', () => {
  for (const timestamp of ['00:05', '67:12', '2026-01-01T10:01:02.1234567+06:00']) {
    const original = [{ ...turn, timestamp }];
    assert.equal(toAiTranscript(original)[0].timestamp, timestamp);
    assert.equal(original[0].timestamp, timestamp);
  }
});

test('numeric time is serialized without unit conversion or Date parsing', () => {
  for (const [timestamp, expected] of [[0, '0'], [1250, '1250'], [1.25, '1.25'], [1735689600000, '1735689600000']]) {
    const original = [{ ...turn, timestamp }];
    assert.equal(toAiTranscript(original)[0].timestamp, expected);
    assert.equal(original[0].timestamp, timestamp);
    assert.equal(typeof original[0].timestamp, 'number');
  }
});

test('real startMs can supply time, including zero, while a provided timestamp takes precedence', () => {
  for (const startMs of [0, 1250]) {
    const original = [{ speaker: 'operator', text: 'Synthetic', startMs, endMs: 3000 }];
    assert.equal(toAiTranscript(original)[0].timestamp, String(startMs));
    assert.equal(Object.hasOwn(original[0], 'timestamp'), false);
  }
  assert.equal(toAiTranscript([{ ...turn, startMs: 1250 }])[0].timestamp, turn.timestamp);
  assert.throws(() => toAiTranscript([{ ...turn, timestamp: '', startMs: 1250 }]), code('AI_TIMESTAMP_INVALID'));
});

test('missing/null time is rejected; end time and neighbor time are not invented as start time', () => {
  for (const source of [
    { speaker: 'operator', text: 'Synthetic' },
    { ...turn, timestamp: null },
    { ...turn, timestamp: undefined, startMs: null },
    { speaker: 'operator', text: 'Synthetic', endMs: 3000 },
  ]) assert.throws(() => toAiTranscript([source]), code('AI_TIMESTAMP_REQUIRED'));
  assert.throws(() => toAiTranscript([turn, { speaker: 'client', text: 'Missing time' }]), code('AI_TIMESTAMP_REQUIRED'));
});

test('invalid/unsafe numeric timestamps fail explicitly instead of being silently coerced', () => {
  for (const timestamp of ['', ' ', -1, Infinity, NaN, true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => toAiTranscript([{ ...turn, timestamp }]), code('AI_TIMESTAMP_INVALID'));
  }
});

test('only confirmed organizer roles are accepted; known casing/whitespace can normalize', () => {
  for (const speaker of ['operator', 'client', 'system', 'bot']) {
    assert.equal(toAiTranscript([{ ...turn, speaker }])[0].speaker, speaker);
    const original = [{ ...turn, speaker: ` ${speaker.toUpperCase()} ` }];
    assert.equal(toAiTranscript(original)[0].speaker, speaker);
    assert.equal(original[0].speaker, ` ${speaker.toUpperCase()} `);
  }
});

test('unknown roles are never inferred from text, IDs, language or apparent operator names', () => {
  for (const speaker of ['agent', 'customer', 'supervisor', 'unknown', '123', 'оператор']) {
    assert.throws(() => toAiTranscript([{ ...turn, speaker, text: 'Hello, I am an operator' }]), code('AI_SPEAKER_UNSUPPORTED'));
  }
});

test('order, indices, text and frozen original objects remain unchanged', () => {
  const original = Object.freeze([
    Object.freeze({ ...turn, speaker: ' OPERATOR ', timestamp: 1250, originalIndex: 17 }),
    Object.freeze({ turnIndex: 1, speaker: 'client', timestamp: '00:07', text: 'Next synthetic turn' }),
  ]);
  const before = JSON.stringify(original);
  assert.deepEqual(toAiTranscript(original), [
    { turnIndex: 0, speaker: 'operator', timestamp: '1250', text: turn.text },
    { turnIndex: 1, speaker: 'client', timestamp: '00:07', text: 'Next synthetic turn' },
  ]);
  assert.equal(JSON.stringify(original), before);
  assert.throws(() => toAiTranscript([{ ...turn, turnIndex: 1 }]), code('INVALID_TRANSCRIPT'));
});

test('validation errors identify only field/index and never echo private role or text', () => {
  try { toAiTranscript([{ ...turn, speaker: 'private-sensitive-name', text: 'private transcript' }]); assert.fail('Expected error'); }
  catch (error) {
    assert.equal(error.code, 'AI_SPEAKER_UNSUPPORTED');
    assert.deepEqual(error.details, [{ turnIndex: 0, field: 'speaker' }]);
    assert.equal(JSON.stringify(error).includes('private-sensitive-name'), false);
    assert.equal(error.message.includes('private transcript'), false);
  }
});

test('actual HTTP accepts the adapted string/role contract; invalid data is blocked before HTTP', async () => {
  let calls = 0;
  const server = createServer(async (req, res) => {
    calls++;
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.url, '/v1/evaluations');
    assert.ok(payload.transcript.every((item) => typeof item.timestamp === 'string' && item.timestamp.trim()));
    assert.ok(payload.transcript.every((item) => ['operator', 'client', 'system', 'bot'].includes(item.speaker)));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ conversation_id: payload.conversation_id, checklist_id: payload.checklist.id, checklist_version: payload.checklist.version, results: [] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = createAiClient({ AI_MODE: 'http', AI_SERVICE_KIND: 'mock', AI_BASE_URL: `http://127.0.0.1:${server.address().port}` });
  const checklist = { id: '00000000-0000-4000-8000-000000000002', key: 'synthetic', version: 1, name: 'Synthetic', instructions: [], sections: [], criteria: [] };
  const original = { id: '00000000-0000-4000-8000-000000000001', channel: 'voice', language: 'EN', transcript: [{ ...turn, timestamp: 1250, speaker: ' OPERATOR ' }] };
  try {
    await client.evaluate(buildAiRequest(original, checklist));
    assert.equal(calls, 1); assert.equal(original.transcript[0].timestamp, 1250); assert.equal(original.transcript[0].speaker, ' OPERATOR ');
    for (const transcript of [[{ ...turn, timestamp: null }], [{ ...turn, speaker: 'agent' }]]) {
      await assert.rejects(async () => client.evaluate(buildAiRequest({ ...original, transcript }, checklist)), (error) => error.status === 422);
    }
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
