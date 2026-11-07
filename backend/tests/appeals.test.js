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
import { createChecklistSchema } from '../src/modules/checklists/checklists.schema.js';
import { evaluationService } from '../src/modules/evaluations/evaluations.service.js';

test('Appeals API: history, validation, recalculation, context and atomic rollback', async (t) => {
  assert.match(new URL(env.DATABASE_URL).pathname, /test/i, 'Use an isolated test database');
  const official = JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json', import.meta.url), 'utf8'));
  const amendment = JSON.parse(await readFile(new URL('../prisma/seed/call-na-amendment.json', import.meta.url), 'utf8'));
  const prefix = `appeals-${randomUUID()}`;
  const rollback = new Error('ROLLBACK_APPEAL_FIXTURES');
  let server;
  let failAfterDecisionWrite = false;
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      function transactionView(target) {
        return new Proxy(target, { get(object, key) {
          if (key === 'appeal') return new Proxy(object.appeal, { get(model, method) {
            const value = model[method];
            if (method === 'updateMany') return async (args) => {
              const result = await value.call(model, args);
              if (failAfterDecisionWrite) throw new Error('Synthetic failure after decision write');
              return result;
            };
            return typeof value === 'function' ? value.bind(model) : value;
          } });
          if (key === '$transaction') return async (action) => {
            if (typeof action !== 'function') return Promise.all(action);
            await target.$executeRawUnsafe('SAVEPOINT appeal_api_transaction');
            try {
              const result = await action(transactionView(target));
              await target.$executeRawUnsafe('RELEASE SAVEPOINT appeal_api_transaction'); return result;
            } catch (error) {
              await target.$executeRawUnsafe('ROLLBACK TO SAVEPOINT appeal_api_transaction');
              await target.$executeRawUnsafe('RELEASE SAVEPOINT appeal_api_transaction'); throw error;
            }
          };
          const value = object[key]; return typeof value === 'function' ? value.bind(object) : value;
        } });
      }
      const database = transactionView(tx);
      server = createApp({ database }).listen(0, '127.0.0.1'); await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`;
      async function request(path, method = 'GET', body) {
        const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      }
      let counter = 0;
      async function fixture({ channel = 'chat', amended = false } = {}) {
        counter++;
        const conversation = await tx.conversation.create({ data: { externalId: `${prefix}-${counter}`, language: 'RU', channel,
          transcript: [{ turnIndex: 0, timestamp: '00:00:01.250', speaker: 'operator', text: 'Synthetic greeting' },
            { turnIndex: 1, timestamp: '00:00:02.500', speaker: 'client', text: 'Synthetic question' }] } });
        const body = structuredClone(official); body.key = `${prefix}-${counter}`;
        if (amended) Object.assign(body.criteria[0], { allowNa: true, naCondition: amendment.naCondition, applicabilityRule: amendment.applicabilityRule });
        const checklist = await checklistService(database).create(createChecklistSchema.parse(body));
        const original = (await evaluationService(database, createMockAiClient({ overrides: {
          '01': { evidence: [{ turnIndex: 0, quote: 'Synthetic greeting' }], checked_range: { start: 0, end: 0 } },
        } })).create({ conversationId: conversation.id, checklistId: checklist.id })).data;
        return { conversation, checklist, original, criterionId: (key) => original.results.find((result) => result.criterionKey === key).criterionId };
      }
      async function open(item, key = '01', comment = 'Synthetic appeal') {
        const response = await request('/api/appeals', 'POST', { evaluationId: item.original.id, criterionId: item.criterionId(key), comment });
        assert.equal(response.status, 201);
        return response.body.data;
      }
      const decide = (appeal, body) => request(`/api/appeals/${appeal.id}/decision`, 'PATCH', body);
      const change = (appeal, value) => decide(appeal, { decision: 'CHANGE', value, reason: 'Synthetic verified correction', reviewer: 'test-reviewer' });
      async function confirmNa(item, key, rule = 'verified_condition') {
        await tx.applicabilityConfirmation.create({ data: { conversationId: item.conversation.id, checklistId: item.checklist.id,
          criterionKey: key, rule, confirmedBy: 'trusted-test-reviewer', reference: 'Synthetic independent verification' } });
      }

      const item = await fixture();
      let appeal;
      await t.test('POST creates PENDING appeal for the correct evaluation and criterion', async () => {
        appeal = await open(item);
        assert.equal(appeal.status, 'PENDING'); assert.equal(appeal.decision, null);
        assert.equal(appeal.evaluationId, item.original.id); assert.equal(appeal.criterionId, item.criterionId('01'));
        assert.deepEqual(appeal.originalScore, item.original.score); assert.deepEqual(appeal.finalScore, item.original.score);
        assert.deepEqual(appeal.originalResult.evidence, item.original.results[0].evidence);
        assert.deepEqual(appeal.conversation.transcript, item.conversation.transcript);
        assert.equal((await request('/api/appeals', 'POST', { evaluationId: item.original.id, criterionId: item.criterionId('01'), comment: 'Duplicate' })).status, 409);
      });

      await t.test('GET list/card includes criterion, status, context and pagination', async () => {
        const second = await open(item, '02');
        const firstPage = await request('/api/appeals?status=PENDING&pageSize=1');
        const nextPage = await request('/api/appeals?status=PENDING&pageSize=1&page=2');
        assert.equal(firstPage.status, 200); assert.ok(firstPage.body.pagination.total >= 2);
        assert.equal(firstPage.body.data[0].status, 'PENDING'); assert.ok(firstPage.body.data[0].criterion.name);
        assert.notEqual(firstPage.body.data[0].id, nextPage.body.data[0].id);
        const card = await request(`/api/appeals/${appeal.id}`);
        assert.equal(card.status, 200); assert.deepEqual(card.body.data.evaluation.aiResponse, item.original.aiResponse);
        assert.deepEqual(card.body.data.originalResult.checkedRange, item.original.results[0].checkedRange);
        assert.equal((await decide(second, { decision: 'CONFIRM', reason: 'Original answer confirmed' })).status, 200);
      });

      await t.test('CONFIRM closes appeal without changing score; repeated decision is 409', async () => {
        const response = await decide(appeal, { decision: 'CONFIRM', reason: 'Original evidence supports the answer' });
        assert.equal(response.status, 200); assert.equal(response.body.data.status, 'REJECTED');
        assert.equal(response.body.data.decision, 'CONFIRM');
        assert.deepEqual(response.body.data.beforeScore, item.original.score);
        assert.deepEqual(response.body.data.afterScore, item.original.score);
        assert.deepEqual(response.body.data.originalScore, response.body.data.finalScore);
        assert.equal((await change(appeal, true)).status, 409);
        const rejected = await request('/api/appeals?status=REJECTED');
        assert.ok(rejected.body.data.every((row) => row.status === 'REJECTED'));
      });

      await t.test('CHANGE boolean uses existing scoring, preserves original AI response and evidence', async () => {
        appeal = await open(item);
        const response = await change(appeal, true);
        assert.equal(response.status, 200); assert.equal(response.body.data.status, 'ACCEPTED');
        assert.equal(response.body.data.originalScore.total, 0); assert.equal(response.body.data.finalScore.total, 10);
        assert.equal(response.body.data.originalResult.answer, false); assert.equal(response.body.data.currentResult.value, true);
        assert.equal(response.body.data.revisedAnswer, true);
        const original = await request(`/api/evaluations/${item.original.id}`);
        assert.deepEqual(original.body.data, JSON.parse(JSON.stringify(item.original)));
      });

      await t.test('scale change includes already accepted boolean changes and persists before/after snapshots', async () => {
        const scale = await open(item, '04');
        const response = await change(scale, 15);
        assert.equal(response.status, 200); assert.equal(response.body.data.beforeScore.total, 10);
        assert.equal(response.body.data.afterScore.total, 25); assert.equal(response.body.data.finalScore.total, 25);
        const reopened = await request(`/api/appeals/${appeal.id}`);
        assert.equal(reopened.body.data.finalScore.total, 25);
        assert.equal(reopened.body.data.afterScore.total, 10); // Historical snapshot of the earlier decision.
      });

      await t.test('CHANGE to N/A requires independent confirmation and redistributes weights', async () => {
        const identity = await open(item, '03');
        const input = { decision: 'CHANGE', isNa: true, naReason: 'Synthetic request did not require identification', reason: 'Verified independently' };
        const missing = await decide(identity, input);
        assert.equal(missing.status, 422); assert.equal(missing.body.error.code, 'NA_CONDITION_UNCONFIRMED');
        assert.equal((await request(`/api/appeals/${identity.id}`)).body.data.status, 'PENDING');
        await confirmNa(item, '03');
        const response = await decide(identity, input);
        assert.equal(response.status, 200); assert.equal(response.body.data.finalScore.total, 31.25);
        assert.equal(response.body.data.revisedIsNa, true); assert.equal(response.body.data.revisedAnswer, null);
        assert.equal(response.body.data.revisedNaReason, input.naReason);
        assert.equal(response.body.data.finalScore.applicableWeight, 80);
      });

      await t.test('gross-error flag changes independently of the numerical score', async () => {
        const flag = await open(item, '08');
        const response = await change(flag, true);
        assert.equal(response.status, 200); assert.equal(response.body.data.beforeScore.total, 31.25);
        assert.equal(response.body.data.finalScore.total, 31.25); assert.equal(response.body.data.finalScore.grossError, true);
        assert.equal(response.body.data.originalScore.grossError, false);
        const reset = await open(item, '08');
        const cleared = await change(reset, false);
        assert.equal(cleared.status, 200); assert.equal(cleared.body.data.finalScore.total, 31.25);
        assert.equal(cleared.body.data.finalScore.grossError, false);
      });

      await t.test('multiple appeals on the same criterion: latest CHANGE wins; CONFIRM does not revert it', async () => {
        const again = await open(item, '01');
        assert.equal((await change(again, false)).body.data.finalScore.total, 18.75);
        const confirm = await open(item, '01');
        const response = await decide(confirm, { decision: 'CONFIRM', reason: 'Keep the currently reviewed result' });
        assert.equal(response.status, 200); assert.equal(response.body.data.finalScore.total, 18.75);
        assert.equal(response.body.data.currentResult.value, false);
        assert.equal((await request(`/api/appeals/${appeal.id}`)).body.data.afterScore.total, 10);
      });

      await t.test('forbidden N/A and unsupported scale steps leave pending appeals unchanged', async () => {
        for (const key of ['01', '05', '06', '08']) {
          const pending = await open(item, key);
          const response = await decide(pending, { decision: 'CHANGE', isNa: true, naReason: 'Not allowed here', reason: 'Test rejection' });
          assert.equal(response.status, 422); assert.equal(response.body.error.code, 'NA_NOT_ALLOWED');
        }
        const pending = await open(item, '04');
        for (const value of [17, true, 21]) {
          const response = await change(pending, value);
          assert.equal(response.status, 400); assert.equal(response.body.error.code, 'INVALID_REVIEW_VALUE');
        }
        assert.equal((await request(`/api/appeals/${pending.id}`)).body.data.status, 'PENDING');
      });

      await t.test('changing N/A back to a boolean restores the full applicable denominator', async () => {
        const identity = await open(item, '03');
        const response = await change(identity, true);
        assert.equal(response.status, 200);
        assert.equal(response.body.data.beforeScore.applicableWeight, 80);
        assert.equal(response.body.data.finalScore.applicableWeight, 100);
        assert.equal(response.body.data.finalScore.total, 35);
        assert.equal(response.body.data.currentResult.value, true);
      });

      await t.test('greeting rule: v2 voice/call needs missing-start proof, chat still cannot use N/A', async () => {
        for (const channel of ['voice', 'chat']) {
          const call = await fixture({ channel, amended: true });
          const pending = await open(call, '01');
          const input = { decision: 'CHANGE', isNa: true, naReason: 'Synthetic recording starts mid-call', reason: 'Reviewed source recording metadata' };
          assert.equal((await decide(pending, input)).status, 422);
          await confirmNa(call, '01', 'recording_start_missing');
          const response = await decide(pending, input);
          assert.equal(response.status, channel === 'voice' ? 200 : 422);
        }
      });

      await t.test('evaluation/criterion spoofing, drafts, invalid UUIDs, comments and client-calculated scores are rejected', async () => {
        const other = await fixture();
        assert.equal((await request('/api/appeals', 'POST', { evaluationId: item.original.id, criterionId: other.criterionId('01'), comment: 'Wrong pair' })).status, 404);
        assert.equal((await request('/api/appeals', 'POST', { evaluationId: randomUUID(), criterionId: item.criterionId('01'), comment: 'Missing evaluation' })).status, 404);
        const conversation = await tx.conversation.create({ data: { externalId: `${prefix}-draft`, language: 'EN', channel: 'chat', transcript: [] } });
        const draft = await tx.evaluation.create({ data: { conversationId: conversation.id, checklistId: item.checklist.id } });
        assert.equal((await request('/api/appeals', 'POST', { evaluationId: draft.id, criterionId: item.criterionId('01'), comment: 'Draft' })).status, 409);
        for (const comment of ['', ' ', 'x'.repeat(4001)]) {
          assert.equal((await request('/api/appeals', 'POST', { evaluationId: other.original.id, criterionId: other.criterionId('01'), comment })).status, 400);
        }
        for (const query of ['status=CLOSED', 'page=0', 'pageSize=101']) assert.equal((await request('/api/appeals?' + query)).status, 400);
        assert.equal((await request('/api/appeals/not-a-uuid')).status, 400);
        assert.equal((await request(`/api/appeals/${randomUUID()}`)).status, 404);
        const pending = await open(other);
        for (const body of [
          { decision: 'CHANGE', value: true, reason: '' },
          { decision: 'CHANGE', value: true, reason: 'Valid', total: 100 },
          { decision: 'CHANGE', isNa: true, reason: 'Valid', naReason: 'Valid', naConditionMet: true },
          { decision: 'CONFIRM', reason: 'Valid', value: true },
          { decision: 'CHANGE', value: true, reason: 'Valid', evaluationId: item.original.id },
        ]) assert.equal((await decide(pending, body)).status, 400);
      });

      await t.test('failure after writing a decision rolls back status, typed answer and scoring snapshots', async () => {
        const isolated = await fixture(); const pending = await open(isolated);
        failAfterDecisionWrite = true;
        assert.equal((await change(pending, true)).status, 500);
        failAfterDecisionWrite = false;
        const stored = await tx.appeal.findUniqueOrThrow({ where: { id: pending.id } });
        assert.equal(stored.status, 'PENDING'); assert.equal(stored.decision, null);
        assert.equal(stored.revisedAnswer, null); assert.equal(stored.beforeScore, null); assert.equal(stored.afterScore, null);
        assert.equal((await request(`/api/appeals/${pending.id}`)).body.data.finalScore.total, 0);
        assert.equal((await change(pending, true)).body.data.finalScore.total, 10);
        assert.deepEqual((await request(`/api/evaluations/${isolated.original.id}`)).body.data, JSON.parse(JSON.stringify(isolated.original)));
      });

      await t.test('database history guards and original snapshots remain intact', async () => {
        await tx.$executeRawUnsafe('SAVEPOINT expected_history_rejection');
        await assert.rejects(() => tx.appeal.update({ where: { id: appeal.id }, data: { decisionReason: 'Overwrite forbidden' } }), /cannot be overwritten/i);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_history_rejection');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT expected_history_rejection');
        assert.deepEqual((await request(`/api/evaluations/${item.original.id}`)).body.data, JSON.parse(JSON.stringify(item.original)));
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      });

      await t.test('legacy cards stay readable without inventing missing typed answers or scores', async () => {
        const conversation = await tx.conversation.create({ data: { externalId: `${prefix}-legacy`, language: 'EN', channel: 'chat', transcript: [{ speaker: 'operator', text: 'Legacy synthetic transcript' }] } });
        const evaluation = await tx.evaluation.create({ data: { conversationId: conversation.id, checklistId: item.checklist.id } });
        await tx.criterionResult.createMany({ data: item.checklist.criteria.map((criterion) => ({
          evaluationId: evaluation.id, checklistId: item.checklist.id, criterionId: criterion.id, points: 0,
          explanation: 'Legacy raw points with no typed answer', evidence: [],
        })) });
        await tx.evaluation.update({ where: { id: evaluation.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
        const result = await tx.criterionResult.findFirstOrThrow({ where: { evaluationId: evaluation.id } });
        const legacy = await tx.appeal.create({ data: { criterionResultId: result.id, comment: 'Legacy synthetic appeal' } });
        const response = await request(`/api/appeals/${legacy.id}`);
        assert.equal(response.status, 200); assert.equal(response.body.data.reviewable, false);
        assert.equal(response.body.data.reviewError, 'EVALUATION_NOT_REVIEWABLE');
        assert.equal(response.body.data.originalScore, null); assert.equal(response.body.data.finalScore, null);
        assert.equal(response.body.data.originalResult.explanation, 'Legacy raw points with no typed answer');
        assert.equal((await decide(legacy, { decision: 'CONFIRM', reason: 'Cannot safely recalculate legacy scores' })).status, 409);
      });

      await new Promise((resolve) => server.close(resolve)); server = undefined;
      throw rollback;
    }, { timeout: 120000 }), (error) => error === rollback);
    assert.equal(await prisma.conversation.count({ where: { externalId: { startsWith: prefix } } }), 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
