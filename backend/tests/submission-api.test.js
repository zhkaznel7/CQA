import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/database/client.js';
import { createHttpAiClient } from '../src/ai-client/http-client.js';
import { createMockAiClient } from '../src/ai-client/mock-client.js';
import official from '../prisma/seed/official-checklist.json' with { type: 'json' };

test('uploaded control group exports actual model, one-based evidence, and failed IDs', async t => {
  assert.match(new URL(env.DATABASE_URL).pathname, /test/i);
  const group = 'test-' + randomUUID();
  const modelName = 'Synthetic test model';
  const aiClient = createHttpAiClient({ AI_SERVICE_KIND: 'ai' }, async (_, init) => {
    const request = JSON.parse(init.body);
    if (request.transcript[0].text === 'Unavailable') return new Response(null, { status: 503 });
    const data = await createMockAiClient({ overrides: {
      '03': { answer: null, na: true, na_reason: 'Public information', evidence: [{ turnIndex: 0, quote: 'Public tariff?' }] },
    } }).evaluate(request);
    return Response.json(data, { headers: { 'x-cqa-model-name': modelName, 'x-cqa-model-mode': 'local' } });
  });
  const server = createApp({ aiClient }).listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  });
  await once(server, 'listening');
  async function request(path, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : {});
    return { status: response.status, json: await response.json() };
  }
  const records = Array.from({ length: 10 }, (_, i) => ({
    conversation_id: 'sample-' + i, language: 'EN', channel: 'agent chat', audio_url: null,
    transcript: [{ speaker: 'client', text: i === 1 ? 'Unavailable' : 'Public tariff?', timestamp: '00:00' }],
  }));
  const payload = { isSuccess: true, data: { dataset_group_id: group, total_records: 10, records } };
  assert.equal((await request('/conversations/upload', payload)).json.data.imported, 10);
  assert.equal((await request('/conversations/upload', payload)).json.data.duplicates, 10);
  const change = structuredClone(payload);
  change.data.records[0].transcript[0].text = 'Different source';
  assert.equal((await request('/conversations/upload', change)).status, 409);
  const { json: { data: conversations } } = await request('/conversations?group_id=' + group);
  const { json: { data: checklist } } = await request('/checklists', { ...official, key: group });
  const query = new URLSearchParams({ group_id: group, team: 'Test', checklistId: checklist.id });
  const initial = await request('/exports/prod?' + query);
  assert.equal(initial.json.results.filter(row => row.status === 'error').length, 10);
  const conversation = id => conversations.find(row => row.externalId === id).id;
  const evaluate = id => request('/evaluations', { conversationId: conversation(id), checklistId: checklist.id });
  const success = await evaluate('sample-0');
  assert.equal(success.status, 201);
  assert.equal((await evaluate('sample-1')).status, 503);
  const history = await request('/evaluations?conversationId=' + conversation('sample-0'));
  assert.equal(history.json.data[0].id, success.json.data.id);
  const { json: file } = await request('/exports/prod?' + query);
  assert.deepEqual(file.model, { name: modelName, mode: 'local' });
  assert.equal(file.results.length, 10);
  const row = file.results.find(entry => entry.conversation_id === 'sample-0');
  assert.equal(row.status, 'ok');
  assert.equal(row.criteria[2].value, null);
  assert.deepEqual(row.criteria[2].evidence_turns, [1]);
  assert.match(file.results.find(entry => entry.conversation_id === 'sample-1').error, /AI_UNAVAILABLE/);
});
