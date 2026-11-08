import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { prisma } from '../src/database/client.js';
import { env } from '../src/config/env.js';
import { createMockAiClient } from '../src/ai-client/mock-client.js';
import { createHttpAiClient } from '../src/ai-client/http-client.js';
import { checklistService } from '../src/modules/checklists/checklists.service.js';
import { createChecklistSchema, versionChecklistSchema } from '../src/modules/checklists/checklists.schema.js';

test('p1-ru-027 HTTP mock: independent N/A, persistence, GET, rejected protected requests and safe retries', async t => {
  assert.match(new URL(env.DATABASE_URL).pathname, /test/i, 'Use an isolated test database');
  const source = JSON.parse(await readFile(new URL('./fixtures/p1-ru-027.json', import.meta.url)));
  const official = JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json', import.meta.url)));
  const namespace = 'identity-' + randomUUID();
  const rollback = new Error('ROLLBACK_IDENTITY_NA_FIXTURES');
  let server, mockServer, badEvidence = false, useNa = true, mockCalls = 0;
  let additionalNaKey, missingNaReason = false;
  const mock = createMockAiClient();
  try {
    mockServer = createServer(async (req, res) => {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/evaluations');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8')); mockCalls++;
      const payload = await mock.evaluate(request);
      for (const row of payload.results) {
        const criterion = request.checklist.criteria.find(c => c.key === row.criterion_id);
        row.answer = criterion.type === 'scale' ? Math.max(...criterion.scaleSteps.map(s => s.value)) : criterion.type !== 'flag';
      }
      const identity = payload.results.find(row => row.criterion_id === '03');
      if (useNa) Object.assign(identity, { answer: null, na: true,
        na_reason: missingNaReason ? null : 'MOCK: только навигация для самостоятельного просмотра, без раскрытия данных и защищённых действий.',
        evidence: [{ turnIndex: 10, quote: badEvidence ? 'SYNTHETIC QUOTE NOT IN SOURCE' : 'Откройте' }] });
      else identity.answer = false;
      if (additionalNaKey) Object.assign(payload.results.find(row => row.criterion_id === additionalNaKey), {
        answer: null, na: true, na_reason: 'MOCK: synthetic N/A for an independently unconfirmed criterion.',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload));
    }).listen(0, '127.0.0.1'); await once(mockServer, 'listening');
    await assert.rejects(prisma.$transaction(async tx => {
      let sequence = 0;
      const database = new Proxy(tx, { get(target, key) {
        if (key === '$transaction') return async action => {
          if (typeof action !== 'function') return Promise.all(action);
          const name = 'identity_' + (++sequence); await tx.$executeRawUnsafe('SAVEPOINT ' + name);
          try { const value = await action(tx); await tx.$executeRawUnsafe('RELEASE SAVEPOINT ' + name); return value; }
          catch (error) { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT ' + name); await tx.$executeRawUnsafe('RELEASE SAVEPOINT ' + name); throw error; }
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      const checklist = await checklistService(database).create(createChecklistSchema.parse({ ...official, key: namespace }));
      const client = createHttpAiClient({ AI_MODE: 'http', AI_SERVICE_KIND: 'mock', AI_BASE_URL: 'http://127.0.0.1:' + mockServer.address().port });
      server = createApp({ database, aiClient: client }).listen(0, '127.0.0.1'); await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      async function request(path, body) {
        const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      }
      let counter = 0;
      async function fixture(mutate = () => {}, checklistId = checklist.id) {
        const record = structuredClone(source); mutate(record);
        const conversation = await tx.conversation.create({ data: { groupId: namespace + '-' + (++counter), externalId: record.conversation_id,
          language: record.language, channel: record.channel, audioUrl: record.audio_url,
          transcript: record.transcript.map((turn, turnIndex) => ({ ...turn, turnIndex })) } });
        return { conversation, input: { conversationId: conversation.id, checklistId } };
      }
      let item, saved, rejected;
      await t.test('all eight technically valid results save with criterion 03 N/A and no manual confirmation', async () => {
        item = await fixture();
        assert.equal(await tx.applicabilityConfirmation.count({ where: { conversationId: item.conversation.id } }), 0);
        const response = await request('/api/evaluations', item.input);
        assert.equal(response.status, 201); saved = response.body.data;
        assert.equal(saved.status, 'COMPLETED'); assert.equal(saved.results.length, 8);
        assert.equal(saved.results.find(r => r.criterionKey === '03').isNa, true);
        assert.equal(saved.score.total, 100); assert.equal(saved.score.applicableWeight, 80);
        assert.equal((await tx.conversation.findUniqueOrThrow({ where: { id: item.conversation.id } })).externalId, 'p1-ru-027');
      });
      await t.test('GET restores the original eight answers, explanation, proof and score; source is unchanged', async () => {
        const read = await request('/api/evaluations/' + saved.id);
        assert.equal(read.status, 200); assert.deepEqual(read.body.data, saved);
        const conversation = (await request('/api/conversations/' + item.conversation.id)).body.data;
        assert.equal(conversation.channel, source.channel);
        assert.deepEqual(conversation.transcript.map(({ turnIndex, ...turn }) => turn), source.transcript);
      });
      await t.test('repeat POST returns reused 200 without a second paid/provider attempt', async () => {
        const before = mockCalls, response = await request('/api/evaluations', item.input);
        assert.equal(response.status, 200); assert.equal(response.body.reused, true);
        assert.deepEqual(response.body.data, saved); assert.equal(mockCalls, before);
      });
      await t.test('a valid identity N/A does not confirm another N/A; error identifies criterion 02', async () => {
        const other = await fixture(); additionalNaKey = '02';
        try {
          const before = mockCalls, response = await request('/api/evaluations', other.input);
          assert.equal(response.status, 502); assert.equal(response.body.error.code, 'AI_NA_UNCONFIRMED');
          assert.deepEqual(response.body.error.details, [{ criterionKey: '02' }]);
          assert.equal(mockCalls, before + 1);
          assert.equal(await tx.evaluation.count({ where: other.input }), 0);
        } finally { additionalNaKey = undefined; }
      });
      await t.test('missing N/A reason is a technical error identifying 03, not an applicability rejection', async () => {
        const other = await fixture(); missingNaReason = true;
        try {
          const response = await request('/api/evaluations', other.input);
          assert.equal(response.status, 502); assert.equal(response.body.error.code, 'AI_INVALID_NA');
          assert.deepEqual(response.body.error.details, [{ criterionKey: '03' }]);
          assert.equal(await tx.evaluation.count({ where: other.input }), 0);
        } finally { missingNaReason = false; }
      });
      await t.test('unexpected transcript metadata cannot grant identity N/A and identifies 03 safely', async () => {
        for (const extra of [{ accountBalance: 99999 }, { metadata: { authenticated: true } }]) {
          const other = await fixture(record => Object.assign(record.transcript[10], extra));
          const response = await request('/api/evaluations', other.input);
          assert.equal(response.status, 502); assert.equal(response.body.error.code, 'AI_NA_UNCONFIRMED');
          assert.deepEqual(response.body.error.details, [{ criterionKey: '03' }]);
          assert.ok(!JSON.stringify(response.body).includes('99999'));
          assert.ok(!JSON.stringify(response.body).includes('authenticated'));
          assert.equal(await tx.evaluation.count({ where: other.input }), 0);
        }
      });
      await t.test('protected actions, personal values and ambiguous followups reject plausible AI N/A and save nothing', async () => {
        for (const [speaker, text] of [['client', 'Переведите деньги с моего счёта.'], ['client', 'Покажите мой баланс.'],
          ['operator', 'Ваш тариф Персональный, баланс 99999 тенге.'], ['client', 'А как решить вопрос со мной лично?']]) {
          const bad = await fixture(record => record.transcript.push({ speaker, text, timestamp: '00:30' }));
          rejected ??= bad;
          const response = await request('/api/evaluations', bad.input);
          assert.equal(response.status, 502); assert.equal(response.body.error.code, 'AI_NA_UNCONFIRMED');
          assert.deepEqual(response.body.error.details, [{ criterionKey: '03' }]);
          assert.equal(await tx.evaluation.count({ where: bad.input }), 0);
        }
      });
      await t.test('valid semantic applicability never bypasses technical quote validation', async () => {
        const bad = await fixture(); badEvidence = true;
        try {
          const response = await request('/api/evaluations', bad.input);
          assert.equal(response.status, 502); assert.equal(response.body.error.code, 'AI_INVALID_EVIDENCE');
          assert.deepEqual(response.body.error.details, [{ criterionKey: '03' }]);
          assert.equal(await tx.evaluation.count({ where: bad.input }), 0);
        } finally { badEvidence = false; }
      });
      await t.test('v2 greeting amendment does not prevent the unchanged official identity condition', async () => {
        const amendment = JSON.parse(await readFile(new URL('../prisma/seed/call-na-amendment.json', import.meta.url)));
        const { key, ...body } = structuredClone(official);
        Object.assign(body.criteria[0], { allowNa: true, naCondition: amendment.naCondition, applicabilityRule: amendment.applicabilityRule });
        const version = await checklistService(database).version(checklist.id, versionChecklistSchema.parse(body));
        const other = await fixture(() => {}, version.id);
        const response = await request('/api/evaluations', other.input);
        assert.equal(response.status, 201); assert.equal(response.body.data.score.total, 100);
        assert.equal(response.body.data.results.find(row => row.criterionKey === '03').isNa, true);
        assert.equal(response.body.data.results.find(row => row.criterionKey === '01').isNa, false);
        assert.equal(await tx.applicabilityConfirmation.count({ where: { conversationId: other.conversation.id } }), 0);
        assert.deepEqual((await request('/api/evaluations/' + response.body.data.id)).body.data, response.body.data);
        assert.deepEqual((await request('/api/evaluations/' + saved.id)).body.data, saved);
      });
      await t.test('edited criterion definition does not inherit a previous version applicability rule', async () => {
        const { key, ...body } = structuredClone(official); body.criteria[2].description += ' Дополнительное условие.';
        const latest = await tx.checklist.findFirstOrThrow({ where: { key: namespace }, orderBy: { version: 'desc' } });
        const next = await checklistService(database).version(latest.id, versionChecklistSchema.parse(body));
        const changed = await fixture(() => {}, next.id);
        const response = await request('/api/evaluations', changed.input);
        assert.equal(response.status, 502); assert.equal(response.body.error.code, 'AI_NA_UNCONFIRMED');
        assert.deepEqual((await request('/api/evaluations/' + saved.id)).body.data, saved);
      });
      await t.test('ordinary non-N/A answer stays valid; rejection causes no automatic retry', async () => {
        useNa = false;
        const applicable = rejected;
        const before = mockCalls, response = await request('/api/evaluations', applicable.input);
        assert.equal(response.status, 201); assert.equal(mockCalls, before + 1);
        assert.equal(response.body.data.results.find(r => r.criterionKey === '03').isNa, false);
        assert.equal(response.body.data.results.find(r => r.criterionKey === '03').answer, false);
        assert.equal(response.body.data.score.total, 80);
        assert.deepEqual((await request('/api/evaluations/' + response.body.data.id)).body.data, response.body.data);
      });
      throw rollback;
    }, { timeout: 60000 }), error => error === rollback);
  } finally {
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    await new Promise(resolve => mockServer ? mockServer.close(resolve) : resolve());
    await prisma.$disconnect();
  }
});
