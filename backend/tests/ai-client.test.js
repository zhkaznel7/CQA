import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createAiClient } from '../src/ai-client/index.js';
import { aiConfigSchema } from '../src/ai-client/ai-config.js';
import { createMockAiClient } from '../src/ai-client/mock-client.js';
import { parseChecklist } from '../src/modules/scoring/scoring.schema.js';
import { calculateScore } from '../src/modules/scoring/scoring.service.js';
import { buildAiRequest, validateAiResponse } from '../src/modules/evaluations/ai-contract.js';

const conversation = { id: '00000000-0000-4000-8000-000000000001', channel: 'voice', language: 'RU',
  transcript: [{ turnIndex: 0, timestamp: '00:00:01.250', speaker: 'operator', text: 'Synthetic greeting' },
    { turnIndex: 1, timestamp: 1500, speaker: 'client', text: 'Synthetic question' }] };
const checklist = parseChecklist({ ...JSON.parse(readFileSync(new URL('../prisma/seed/official-checklist.json', import.meta.url), 'utf8')),
  id: '00000000-0000-4000-8000-000000000002', version: 1 });
const request = buildAiRequest(conversation, checklist);
const bad = (code) => (error) => error.code === code;
const confirmation = (criterionKey, rule = 'verified_condition', source = conversation, version = checklist) => ({
  conversationId: source.id, checklistId: version.id, criterionKey, rule, confirmedBy: 'test-reviewer', reference: 'Synthetic independently verified fact',
});

test('wire fields preserve timestamp text and serialize numeric time without mutating the source', () => {
  assert.deepEqual(Object.keys(request), ['conversation_id', 'channel', 'language', 'transcript', 'checklist']);
  assert.deepEqual(Object.keys(request.checklist.criteria[0]), ['key', 'name', 'type', 'description', 'sectionKey', 'weight', 'scaleSteps', 'allowNa', 'naCondition']);
  assert.equal(request.transcript[0].timestamp, '00:00:01.250');
  assert.equal(request.transcript[1].timestamp, '1500');
  assert.equal(conversation.transcript[1].timestamp, 1500);
});

test('wire channel aliases match team AI without changing stored data or N/A context', () => {
  for (const [stored, expected] of [['chat', 'agent chat'], ['agent chat', 'agent chat'], ['voice', 'voice call'], ['call', 'voice call'], ['voice call', 'voice call']]) {
    const original = { ...conversation, channel: stored };
    const payload = buildAiRequest(original, checklist);
    assert.equal(payload.channel, expected);
    assert.equal(original.channel, stored);
    assert.deepEqual(original.transcript, conversation.transcript);
  }
  assert.equal(buildAiRequest({ ...conversation, channel: 'custom-channel' }, checklist).channel, 'custom-channel');
});

test('local adapter supports RU/KZ/EN and declared boolean/scale/flag types', async () => {
  for (const language of ['RU', 'KZ', 'EN']) {
    const response = await createMockAiClient().evaluate({ ...request, language });
    const { answers } = validateAiResponse(response, conversation, checklist, []);
    assert.equal(calculateScore(checklist, answers).total, 0);
    assert.ok(response.results.every((result) => result.explanation.includes('MOCK')));
  }
});

test('HTTP transport calls POST /v1/evaluations with JSON; no redirects', async () => {
  let called = false;
  const client = createAiClient({ AI_MODE: 'http', AI_BASE_URL: 'http://localhost:8001', AI_SERVICE_KIND: 'mock' }, async (url, options) => {
    called = true;
    assert.equal(url, 'http://localhost:8001/v1/evaluations');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Content-Type'], 'application/json'); assert.ok(options.signal);
    assert.deepEqual(JSON.parse(options.body), request);
    return Response.json(await createMockAiClient().evaluate(request));
  });
  assert.equal(client.source, 'mock'); assert.equal(client.transport, 'http');
  validateAiResponse(await client.evaluate(request), conversation, checklist, []);
  assert.equal(called, true);
});

test('AI URL config rejects credentials, paths, fragments, queries and non-HTTP schemes', () => {
  for (const value of ['file:///tmp/test', 'ftp://localhost', 'http://user:secret@localhost:8001', 'http://localhost:8001/other', 'http://localhost:8001?token=private', 'http://localhost:8001/#fragment']) {
    assert.equal(aiConfigSchema.safeParse({ AI_BASE_URL: value }).success, false);
  }
  assert.equal(aiConfigSchema.parse({}).AI_TIMEOUT_MS, 100000);
  assert.equal(aiConfigSchema.parse({}).AI_MODE, 'http');
});

test('production mock requires explicit opt-in for both local and HTTP mocks', () => {
  for (const settings of [{ AI_MODE: 'mock', AI_SERVICE_KIND: 'ai' }, { AI_MODE: 'http', AI_SERVICE_KIND: 'mock' }]) {
    const environment = { ...process.env, ...settings, NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://synthetic@127.0.0.1:55499/cqa_test', AI_ALLOW_MOCK_IN_PRODUCTION: 'false' };
    const args = ['--input-type=module', '-e', "await import('./src/config/env.js')"];
    const blocked = spawnSync(process.execPath, args, { env: environment, encoding: 'utf8' });
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /Production mock requires explicit/);
    const explicit = spawnSync(process.execPath, args, { env: { ...environment, AI_ALLOW_MOCK_IN_PRODUCTION: 'true' }, encoding: 'utf8' });
    assert.equal(explicit.status, 0);
  }
});

test('AI network errors and invalid responses are sanitized and never fall back to a mock', async () => {
  for (const [implementation, expected] of [
    [async () => { throw new Error('private URL/token'); }, 'AI_UNAVAILABLE'],
    [async () => { throw new DOMException('private', 'TimeoutError'); }, 'AI_TIMEOUT'],
    [async () => new Response('private payload', { status: 500 }), 'AI_HTTP_ERROR'],
    [async () => new Response('not json'), 'AI_INVALID_JSON'],
    [async () => new Response('x'.repeat(101)), 'AI_RESPONSE_TOO_LARGE'],
    [async () => new Response('x', { headers: { 'content-length': '101' } }), 'AI_RESPONSE_TOO_LARGE'],
  ]) {
    const client = createAiClient({ AI_MODE: 'http', AI_MAX_RESPONSE_BYTES: 100 }, implementation);
    await assert.rejects(() => client.evaluate(request), (error) => bad(expected)(error) && !error.message.includes('private'));
  }
});

test('upstream HTTP 503/504 keep unavailable/timeout semantics without exposing provider bodies', async () => {
  for (const [status, code] of [[503, 'AI_UNAVAILABLE'], [504, 'AI_TIMEOUT']]) {
    const client = createAiClient({ AI_MODE: 'http' }, async () => new Response('private upstream body', { status }));
    await assert.rejects(() => client.evaluate(request), (error) => error.status === status && error.code === code && !error.message.includes('private'));
  }
});

test('HTTP client handles actual local HTTP JSON, redirects, timeout and broken JSON', async () => {
  const server = createServer(async (req, res) => {
    req.resume();
    if (req.headers['x-unused']) return;
    if (server.scenario === 'redirect') { res.writeHead(302, { Location: '/other' }); res.end(); }
    else if (server.scenario === 'timeout') { /* Deliberately wait for client abort. */ }
    else if (server.scenario === 'json') { res.end('broken-json'); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await createMockAiClient().evaluate(request))); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = createAiClient({ AI_MODE: 'http', AI_SERVICE_KIND: 'mock', AI_BASE_URL: `http://127.0.0.1:${server.address().port}`, AI_TIMEOUT_MS: 100 });
  try {
    validateAiResponse(await client.evaluate(request), conversation, checklist, []);
    server.scenario = 'redirect'; await assert.rejects(() => client.evaluate(request), bad('AI_UNAVAILABLE'));
    server.scenario = 'json'; await assert.rejects(() => client.evaluate(request), bad('AI_INVALID_JSON'));
    server.scenario = 'timeout'; await assert.rejects(() => client.evaluate(request), bad('AI_TIMEOUT'));
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

test('response identities, missing/duplicate/unknown criteria, steps and types are checked', async () => {
  for (const mutate of [
    (response) => response.conversation_id = checklist.id,
    (response) => response.checklist_version++,
    (response) => response.results.pop(),
    (response) => response.results.push(response.results[0]),
    (response) => response.results[0].criterion_id = 'unknown',
    (response) => response.results[3].answer = 17,
    (response) => response.results[0].answer = 1,
    (response) => response.results[7].answer = 'true',
    (response) => response.total = 100,
  ]) {
    const response = await createMockAiClient().evaluate(request); mutate(response);
    assert.throws(() => validateAiResponse(response, conversation, checklist, []), (error) => error.status === 502);
  }
});

test('exact evidence quotes and inclusive checked ranges are enforced', async () => {
  const response = await createMockAiClient().evaluate(request);
  response.results[0].evidence = [{ turnIndex: 0, quote: 'greeting' }];
  validateAiResponse(response, conversation, checklist, []);
  for (const mutate of [
    (item) => item.evidence[0].quote = 'invented',
    (item) => item.evidence[0].turnIndex = 2,
    (item) => item.checked_range = { start: 1, end: 1 },
    (item) => item.checked_range = { start: 1, end: 0 },
    (item) => item.checked_range = { start: 0, end: 2 },
    (item) => { item.evidence = []; item.checked_range = null; },
  ]) {
    const changed = structuredClone(response); mutate(changed.results[0]);
    assert.throws(() => validateAiResponse(changed, conversation, checklist, []), (error) => error.status === 502);
  }
  response.results[0].checked_range = null;
  validateAiResponse(response, conversation, checklist, []);
});

test('AI assertion alone never confirms N/A; independent confirmation is version-specific', async () => {
  const response = await createMockAiClient({ overrides: { '03': { answer: null, na: true, na_reason: 'Synthetic reason' } } }).evaluate(request);
  assert.throws(() => validateAiResponse(response, conversation, checklist, []), bad('AI_NA_UNCONFIRMED'));
  assert.throws(() => validateAiResponse(response, conversation, checklist, [{ ...confirmation('03'), checklistId: conversation.id }]), bad('AI_NA_UNCONFIRMED'));
  const { answers } = validateAiResponse(response, conversation, checklist, [confirmation('03')]);
  assert.deepEqual(answers[2], { criterionKey: '03', isNa: true, naConditionMet: true, naReason: 'Synthetic reason' });
  assert.equal(Object.hasOwn(answers[2], 'value'), false);
});

test('v2 greeting N/A requires the configured call channel AND verified missing recording start', async () => {
  const v2 = structuredClone(checklist); v2.version = 2;
  Object.assign(v2.criteria[0], { allowNa: true, naCondition: 'Only when the recording start is missing',
    applicabilityRule: { kind: 'recording_start_missing', channels: ['voice', 'call'] } });
  const response = await createMockAiClient({ overrides: { '01': { answer: null, na: true, na_reason: 'Recording start absent' } } }).evaluate(buildAiRequest(conversation, v2));
  assert.throws(() => validateAiResponse(response, conversation, v2, []), bad('AI_NA_UNCONFIRMED'));
  assert.throws(() => validateAiResponse(response, conversation, v2, [confirmation('01', 'verified_condition', conversation, v2)]), bad('AI_NA_UNCONFIRMED'));
  const facts = [confirmation('01', 'recording_start_missing', conversation, v2)];
  validateAiResponse(response, conversation, v2, facts);
  assert.throws(() => validateAiResponse(response, { ...conversation, channel: 'chat' }, v2, facts), bad('AI_NA_UNCONFIRMED'));
  const old = structuredClone(response); old.checklist_version = 1;
  assert.throws(() => validateAiResponse(old, conversation, checklist, facts), bad('AI_NA_UNCONFIRMED'));
});
