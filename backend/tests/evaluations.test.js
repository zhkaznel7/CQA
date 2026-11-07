import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/database/client.js';
import { createMockAiClient } from '../src/ai-client/mock-client.js';
import { checklistService } from '../src/modules/checklists/checklists.service.js';
import { createChecklistSchema, versionChecklistSchema } from '../src/modules/checklists/checklists.schema.js';

test('Evaluations API, persistence, rollback, dynamic versions and explicit N/A applicability', async (t) => {
  assert.match(new URL(env.DATABASE_URL).pathname, /test/i, 'Use an isolated test database');
  const official = JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json', import.meta.url), 'utf8'));
  const amendment = JSON.parse(await readFile(new URL('../prisma/seed/call-na-amendment.json', import.meta.url), 'utf8'));
  const prefix = `eval-${randomUUID()}`;
  const rollback = new Error('ROLLBACK_EVALUATION_TEST_FIXTURES');
  let server;
  let activeClient = createMockAiClient();
  let calls = 0;
  let lastResponse;
  let lastRequest;
  let forceWriteFailure = false;
  let mutateDuringAi;
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      function transactionView(target) {
        return new Proxy(target, { get(object, key) {
          if (key === 'criterionResult') return new Proxy(object.criterionResult, { get(model, method) {
            if (method === 'createMany' && forceWriteFailure) return () => { throw new Error('Synthetic insert failure'); };
            const value = model[method]; return typeof value === 'function' ? value.bind(model) : value;
          } });
          if (key === '$transaction') return async (action) => {
            if (typeof action !== 'function') return Promise.all(action);
            await target.$executeRawUnsafe('SAVEPOINT api_transaction');
            try {
              const result = await action(transactionView(target));
              await target.$executeRawUnsafe('RELEASE SAVEPOINT api_transaction'); return result;
            } catch (error) {
              await target.$executeRawUnsafe('ROLLBACK TO SAVEPOINT api_transaction');
              await target.$executeRawUnsafe('RELEASE SAVEPOINT api_transaction'); throw error;
            }
          };
          const value = object[key]; return typeof value === 'function' ? value.bind(object) : value;
        } });
      }
      const database = transactionView(tx);
      const aiClient = { source: 'mock', transport: 'local', async evaluate(request) {
        calls++;
        lastRequest = structuredClone(request);
        lastResponse = await activeClient.evaluate(request);
        if (mutateDuringAi) { await mutateDuringAi(); mutateDuringAi = undefined; }
        return lastResponse;
      } };
      server = createApp({ database, aiClient }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`;
      async function request(path, body) {
        const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      }
      let counter = 0;
      async function fixture({ channel = 'chat', language = 'RU', amended = false } = {}) {
        counter++;
        const conversation = await tx.conversation.create({ data: { externalId: `${prefix}-${counter}`, language, channel,
          transcript: [{ turnIndex: 0, timestamp: '00:00:01.250', speaker: 'operator', text: 'Synthetic greeting' },
            { turnIndex: 1, timestamp: '00:00:02.500', speaker: 'client', text: 'Synthetic question' }] } });
        const body = structuredClone(official); body.key = `${prefix}-${counter}`;
        if (amended) Object.assign(body.criteria[0], { allowNa: true, naCondition: amendment.naCondition, applicabilityRule: amendment.applicabilityRule });
        const checklist = await checklistService(database).create(createChecklistSchema.parse(body));
        return { conversation, checklist, body, input: { conversationId: conversation.id, checklistId: checklist.id } };
      }
      async function confirm(fixture, key, rule = 'verified_condition') {
        return tx.applicabilityConfirmation.create({ data: { conversationId: fixture.conversation.id, checklistId: fixture.checklist.id,
          criterionKey: key, rule, confirmedBy: 'synthetic-reviewer', reference: 'Synthetic independently verified evidence' } });
      }

      let saved;
      let first;
      await t.test('POST 201 persists original booleans/scales/flags, ranges, evidence and scoring snapshot', async () => {
        first = await fixture();
        activeClient = createMockAiClient({ overrides: {
          '01': { answer: true, evidence: [{ turnIndex: 0, quote: 'Synthetic greeting' }], checked_range: { start: 0, end: 0 } },
          '04': { answer: 15 }, '06': { answer: 7 }, '08': { answer: true },
        } });
        const response = await request('/api/evaluations', first.input);
        assert.equal(response.status, 201);
        saved = response.body.data;
        assert.equal(saved.status, 'COMPLETED'); assert.equal(saved.isMock, true);
        assert.equal(saved.provider, 'mock'); assert.equal(saved.transport, 'local');
        assert.equal(saved.score.total, 35.5); assert.equal(saved.score.grossError, true);
        assert.deepEqual(saved.aiResponse, lastResponse);
        const c1 = saved.results.find((result) => result.criterionKey === '01');
        assert.equal(c1.answer, true); assert.equal(c1.rawPoints, 1);
        assert.deepEqual(c1.evidence, [{ turnIndex: 0, quote: 'Synthetic greeting' }]);
        assert.deepEqual(c1.checkedRange, { start: 0, end: 0 });
        assert.equal(saved.results.find((result) => result.criterionKey === '08').answer, true);
        assert.equal(saved.results.find((result) => result.criterionKey === '08').rawPoints, 0);
      });

      await t.test('GET saved evaluation restores the original AI response and exact stored score', async () => {
        const response = await request(`/api/evaluations/${saved.id}`);
        assert.equal(response.status, 200); assert.deepEqual(response.body.data, saved);
        assert.equal((await request(`/api/evaluations/${randomUUID()}`)).status, 404);
        assert.equal((await request('/api/evaluations/not-a-uuid')).status, 400);
      });

      await t.test('repeat POST is 200/reused, never calls AI again or overwrites the completed evaluation', async () => {
        activeClient = createMockAiClient({ scenario: 'unavailable' });
        const before = calls;
        const response = await request('/api/evaluations', first.input);
        assert.equal(response.status, 200); assert.equal(response.body.reused, true);
        assert.deepEqual(response.body.data, saved); assert.equal(calls, before);
        assert.equal(await tx.evaluation.count({ where: { conversationId: first.conversation.id, checklistId: first.checklist.id } }), 1);
      });

      await t.test('independent N/A confirmation gives 88.13 and persists the N/A reason and null answer', async () => {
        const item = await fixture(); await confirm(item, '03');
        activeClient = createMockAiClient({ overrides: {
          '01': { answer: true }, '02': { answer: true }, '03': { na: true, answer: null, na_reason: 'Synthetic identity check not required' },
          '04': { answer: 15 }, '05': { answer: true }, '06': { answer: 7 }, '07': { answer: true },
        } });
        const response = await request('/api/evaluations', item.input);
        assert.equal(response.status, 201); assert.equal(response.body.data.score.total, 88.13);
        const result = response.body.data.results.find((result) => result.criterionKey === '03');
        assert.equal(result.answer, null); assert.equal(result.isNa, true); assert.equal(result.rawPoints, null);
        assert.equal(result.naReason, 'Synthetic identity check not required');
        assert.deepEqual((await request(`/api/evaluations/${response.body.data.id}`)).body.data, response.body.data);
      });

      await t.test('N/A without independent confirmation, even with a plausible AI reason, returns 502', async () => {
        const item = await fixture(); activeClient = createMockAiClient({ scenario: 'na' });
        const response = await request('/api/evaluations', item.input);
        assert.equal(response.status, 502); assert.equal(response.body.error.code, 'AI_NA_UNCONFIRMED');
        assert.equal(await tx.evaluation.count({ where: item.input }), 0);
      });

      await t.test('greeting N/A succeeds only for explicit rule + call/voice + recording-start confirmation', async () => {
        for (const [channel, hasFact, expected] of [['voice', false, 502], ['call', true, 201], ['chat', true, 502]]) {
          const item = await fixture({ channel, amended: true });
          if (hasFact) await confirm(item, '01', 'recording_start_missing');
          activeClient = createMockAiClient({ overrides: { '01': { na: true, answer: null, na_reason: 'Synthetic recording starts mid-call' } } });
          const response = await request('/api/evaluations', item.input);
          assert.equal(response.status, expected);
        }
        const old = await fixture({ channel: 'voice' }); await confirm(old, '01', 'recording_start_missing');
        assert.equal((await request('/api/evaluations', old.input)).status, 502);
      });

      await t.test('bad AI steps, evidence, missing/duplicate criteria and mock errors do not save partial data', async () => {
        for (const [scenario, expected] of [['bad-scale', 502], ['false-quote', 502], ['missing', 502], ['duplicate', 502], ['timeout', 504], ['unavailable', 503], ['invalid-json', 502]]) {
          const item = await fixture(); activeClient = createMockAiClient({ scenario });
          assert.equal((await request('/api/evaluations', item.input)).status, expected, scenario);
          assert.equal(await tx.evaluation.count({ where: item.input }), 0);
        }
      });

      await t.test('database failure after creating Evaluation rolls back both Evaluation and results', async () => {
        const item = await fixture(); activeClient = createMockAiClient(); forceWriteFailure = true;
        const response = await request('/api/evaluations', item.input);
        forceWriteFailure = false;
        assert.equal(response.status, 500);
        assert.equal(await tx.evaluation.count({ where: item.input }), 0);
        assert.equal(await tx.criterionResult.count({ where: { checklistId: item.checklist.id } }), 0);
      });

      await t.test('concurrent input changes cause 409 instead of attaching AI output to changed data', async () => {
        const item = await fixture(); activeClient = createMockAiClient();
        mutateDuringAi = () => tx.conversation.update({ where: { id: item.conversation.id }, data: { channel: 'voice' } });
        assert.equal((await request('/api/evaluations', item.input)).status, 409);
        assert.equal(await tx.evaluation.count({ where: item.input }), 0);
      });

      await t.test('numeric timestamps and known role casing adapt for AI while PostgreSQL and GET keep originals', async () => {
        const item = await fixture();
        const transcript = [
          { turnIndex: 0, timestamp: 1250, speaker: ' OPERATOR ', text: 'Synthetic source preserved' },
          { turnIndex: 1, startMs: 0, endMs: 3000, speaker: 'Client', text: 'Synthetic reply preserved' },
        ];
        await tx.conversation.update({ where: { id: item.conversation.id }, data: { transcript } });
        activeClient = createMockAiClient();
        const response = await request('/api/evaluations', item.input);
        assert.equal(response.status, 201);
        assert.deepEqual(lastRequest.transcript.map((turn) => [turn.timestamp, turn.speaker]), [['1250', 'operator'], ['0', 'client']]);
        assert.deepEqual((await tx.conversation.findUniqueOrThrow({ where: { id: item.conversation.id } })).transcript, transcript);
        assert.deepEqual((await request(`/api/conversations/${item.conversation.id}`)).body.data.transcript, transcript);
        assert.equal(Object.hasOwn(transcript[1], 'timestamp'), false);
      });

      await t.test('missing time and unknown roles return 422 before AI with no writes or source replacement', async () => {
        for (const [turn, expected] of [
          [{ speaker: 'operator', text: 'Synthetic missing time' }, 'AI_TIMESTAMP_REQUIRED'],
          [{ speaker: 'agent', timestamp: '00:05', text: 'Synthetic unknown role' }, 'AI_SPEAKER_UNSUPPORTED'],
        ]) {
          const item = await fixture(); const transcript = [turn];
          await tx.conversation.update({ where: { id: item.conversation.id }, data: { transcript } });
          const beforeCalls = calls;
          const response = await request('/api/evaluations', item.input);
          assert.equal(response.status, 422); assert.equal(response.body.error.code, expected);
          assert.equal(calls, beforeCalls);
          assert.equal(await tx.evaluation.count({ where: item.input }), 0);
          assert.deepEqual((await tx.conversation.findUniqueOrThrow({ where: { id: item.conversation.id } })).transcript, transcript);
        }
      });

      await t.test('raw input changes still yield 409 when normalization would hide the change', async () => {
        for (const [original, changed] of [
          [{ timestamp: 1250, speaker: 'operator' }, { timestamp: '1250', speaker: 'operator' }],
          [{ timestamp: '00:05', speaker: ' OPERATOR ' }, { timestamp: '00:05', speaker: 'operator' }],
        ]) {
          const item = await fixture();
          const transcript = [{ turnIndex: 0, text: 'Synthetic normalization collision', ...original }];
          await tx.conversation.update({ where: { id: item.conversation.id }, data: { transcript } });
          activeClient = createMockAiClient();
          mutateDuringAi = () => tx.conversation.update({ where: { id: item.conversation.id }, data: {
            transcript: [{ turnIndex: 0, text: 'Synthetic normalization collision', ...changed }],
          } });
          const response = await request('/api/evaluations', item.input);
          assert.equal(response.status, 409); assert.equal(response.body.error.code, 'EVALUATION_INPUT_CHANGED');
          assert.equal(await tx.evaluation.count({ where: item.input }), 0);
        }
      });

      await t.test('boolean -> scale 0/2/4 in a new version is passed dynamically; old score stays unchanged', async () => {
        const { key, ...newBody } = structuredClone(first.body);
        Object.assign(newBody.criteria[0], { type: 'scale', scaleSteps: [{ value: 0, label: 'Zero' }, { value: 2, label: 'Middle' }, { value: 4, label: 'Full' }] });
        const version = await checklistService(database).version(first.checklist.id, versionChecklistSchema.parse(newBody));
        activeClient = createMockAiClient({ overrides: { '01': { answer: 2 } } });
        const response = await request('/api/evaluations', { conversationId: first.conversation.id, checklistId: version.id });
        assert.equal(response.status, 201); assert.equal(response.body.data.score.total, 5);
        assert.equal(response.body.data.results.find((result) => result.criterionKey === '01').answer, 2);
        assert.deepEqual((await request(`/api/evaluations/${saved.id}`)).body.data, saved);
      });

      await t.test('invalid request, unavailable IDs and attempts to supply N/A facts in POST are rejected', async () => {
        assert.equal((await request('/api/evaluations', {})).status, 400);
        assert.equal((await request('/api/evaluations', { ...first.input, naConditionMet: true })).status, 400);
        assert.equal((await request('/api/evaluations', { conversationId: randomUUID(), checklistId: first.checklist.id })).status, 404);
        assert.equal((await request('/api/evaluations', { conversationId: first.conversation.id, checklistId: randomUUID() })).status, 404);
      });

      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      await new Promise((resolve) => server.close(resolve)); server = undefined;
      throw rollback;
    }, { timeout: 120000 }), (error) => error === rollback);
    assert.equal(await prisma.conversation.count({ where: { externalId: { startsWith: prefix } } }), 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
