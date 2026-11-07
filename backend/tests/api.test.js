import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createApp } from '../src/app.js';
import { prisma } from '../src/database/client.js';
import { env } from '../src/config/env.js';
import { createConversationSource } from '../src/modules/conversations/organizer-client.js';
import { createChecklistSchema } from '../src/modules/checklists/checklists.schema.js';

// Requests use real HTTP + real PostgreSQL. Mutations run inside a transaction
// that is always rolled back, including immutable checklist/history fixtures.
test('Conversations and Checklists HTTP API with isolated PostgreSQL', async (t) => {
  assert.match(new URL(env.DATABASE_URL).pathname, /test/i, 'Use a dedicated test database');
  const rollback = new Error('ROLLBACK_HTTP_TEST_FIXTURES');
  let server;
  let currentSource;
  const prefix = `api-${randomUUID()}`;
  const record = (suffix, language = 'RU', channel = 'chat') => ({
    externalId: `${prefix}-${suffix}`, language, channel,
    transcript: [{ speaker: 'operator', text: 'Synthetic example', timestamp: '2026-01-01T10:01:02.123+06:00', startMs: '001.250', originalIndex: 17 }],
  });
  const official = JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json', import.meta.url), 'utf8'));
  const body = { ...structuredClone(official), key: prefix };
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      // Preserve Prisma's transaction-list semantics over an existing interactive transaction.
      const database = new Proxy(tx, { get(target, property) {
        if (property === '$transaction') return async (action) => typeof action === 'function' ? action(tx) : Promise.all(action);
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      currentSource = async () => [record('ru'), record('kz', 'KZ'), record('en', 'EN', 'voice')];
      server = createApp({ database, loadConversations: () => currentSource() }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`;
      async function request(path, options = {}) {
        const response = await fetch(base + path, {
          ...options, headers: { 'Content-Type': 'application/json', ...options.headers },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        return { status: response.status, headers: response.headers, body: await response.json() };
      }
      async function databaseReject(action, pattern) {
        await tx.$executeRawUnsafe('SAVEPOINT expected_rejection');
        try { await assert.rejects(action, pattern); }
        finally {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_rejection');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT expected_rejection');
        }
      }

      await t.test('health stays 200 and security headers stay enabled', async () => {
        const response = await request('/api/health');
        assert.equal(response.status, 200);
        assert.equal(response.body.status, 'ok');
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(response.headers.has('x-powered-by'), false);
        assert.equal((await request('/api/health', { headers: { Origin: 'https://untrusted.invalid' } })).status, 403);
        assert.equal((await request('/api/conversations/import', { method: 'POST', body: { text: 'x'.repeat(110000) } })).status, 413);
        const invalidJson = await fetch(base + '/api/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
        assert.equal(invalidJson.status, 400);
      });

      await t.test('valid import and repeated import are idempotent', async () => {
        let response = await request('/api/conversations/import', { method: 'POST', body: {} });
        assert.equal(response.status, 200);
        assert.equal(response.body.data.imported, 3);
        response = await request('/api/conversations/import', { method: 'POST', body: {} });
        assert.equal(response.body.data.imported, 0);
        assert.equal(response.body.data.duplicates, 3);
        const saved = await tx.conversation.findUniqueOrThrow({ where: { groupId_externalId: { groupId: 'DEV', externalId: `${prefix}-ru` } } });
        const changed = record('ru'); changed.transcript[0].text = 'Changed upstream text';
        currentSource = async () => [changed];
        assert.equal((await request('/api/conversations/import', { method: 'POST' })).body.data.duplicates, 1);
        assert.deepEqual((await tx.conversation.findUniqueOrThrow({ where: { id: saved.id } })).transcript, saved.transcript);
      });

      await t.test('single conversation keeps transcript order, indices and original timestamps', async () => {
        const original = await tx.conversation.findUniqueOrThrow({ where: { groupId_externalId: { groupId: 'DEV', externalId: `${prefix}-ru` } } });
        const response = await request(`/api/conversations/${original.id}`);
        assert.equal(response.status, 200);
        assert.equal(response.body.data.transcript[0].timestamp, record('ru').transcript[0].timestamp);
        assert.equal(response.body.data.transcript[0].startMs, '001.250');
        assert.equal(response.body.data.transcript[0].originalIndex, 17);
        assert.equal(response.body.data.transcript[0].turnIndex, 0);
        assert.equal((await request(`/api/conversations/${randomUUID()}`)).status, 404);
        assert.equal((await request('/api/conversations/not-a-uuid')).status, 400);
      });

      await t.test('pagination and RU/KZ/EN + channel filters', async () => {
        for (const language of ['RU', 'KZ', 'EN']) {
          const response = await request(`/api/conversations?language=${language}&pageSize=1`);
          assert.equal(response.status, 200);
          assert.ok(response.body.data.every((row) => row.language === language));
          assert.equal(response.body.data.length, 1);
          assert.equal('transcript' in response.body.data[0], false);
        }
        const filtered = await request('/api/conversations?language=EN&channel=voice&pageSize=1');
        assert.ok(filtered.body.data.every((row) => row.language === 'EN' && row.channel === 'voice'));
        const first = await request('/api/conversations?pageSize=1');
        const second = await request('/api/conversations?pageSize=1&page=2');
        assert.notEqual(first.body.data[0].id, second.body.data[0].id);
        assert.equal((await request('/api/conversations?page=100000')).body.data.length, 0);
        for (const query of ['page=0', 'pageSize=101', 'language=DE', 'channel=', 'page=1.2', 'url=http://127.0.0.1']) {
          assert.equal((await request(`/api/conversations?${query}`)).status, 400);
        }
      });

      await t.test('mixed invalid, empty and duplicate records are reported without leaking data', async () => {
        const extra = record('extra');
        extra.transcript.push({ speaker: 'client', text: 'Second synthetic turn', timestamp: 1250 });
        currentSource = async () => [extra, extra, null, {}, { ...record('bad'), language: 'DE' },
          { ...record('empty'), transcript: [] }, { ...record('empty-id'), externalId: ' ' },
          { ...record('index'), transcript: [{ speaker: 'operator', text: 'Example', turnIndex: 8 }] }];
        const response = await request('/api/conversations/import', { method: 'POST', body: {} });
        assert.equal(response.status, 200);
        assert.equal(response.body.data.imported, 1);
        assert.equal(response.body.data.duplicates, 1);
        assert.equal(response.body.data.invalid, 6);
        assert.equal(JSON.stringify(response.body).includes('Synthetic example'), false);
        const stored = await tx.conversation.findUniqueOrThrow({ where: { groupId_externalId: { groupId: 'DEV', externalId: extra.externalId } } });
        assert.deepEqual(stored.transcript.map((turn) => turn.turnIndex), [0, 1]);
        assert.deepEqual(stored.transcript.map((turn) => turn.timestamp), [extra.transcript[0].timestamp, 1250]);
        currentSource = async () => [];
        assert.equal((await request('/api/conversations/import', { method: 'POST' })).body.data.received, 0);
        currentSource = async () => [null, {}, { ...record('empty'), transcript: [] }];
        assert.equal((await request('/api/conversations/import', { method: 'POST' })).body.data.invalid, 3);
      });

      await t.test('request cannot select an import URL or submit arbitrary records', async () => {
        for (const payload of [{ url: 'http://127.0.0.1:1234' }, { conversations: [] }, null, []]) {
          assert.equal((await request('/api/conversations/import', { method: 'POST', body: payload })).status, 400);
        }
        assert.equal((await request('/api/conversations/import?url=http://localhost', { method: 'POST' })).status, 400);
      });

      await t.test('upstream errors, timeout, redirects, invalid response and byte limits are sanitized', async () => {
        const privateUrl = 'https://organizer.invalid/export?token=private-token';
        const config = { IMPORT_SOURCE: 'organizers', ORGANIZER_API_URL: privateUrl, ORGANIZER_API_TOKEN: 'private-token', IMPORT_TIMEOUT_MS: 50, IMPORT_MAX_BYTES: 1000, IMPORT_MAX_RECORDS: 500 };
        const cases = [
          [async () => new Response('private failure', { status: 500 }), 502],
          [async () => { throw new DOMException(privateUrl, 'TimeoutError'); }, 504],
          [async () => { throw new Error(privateUrl); }, 502],
          [async () => new Response('not-json'), 502],
          [async () => Response.json({ wrong: [] }), 502],
          [async () => new Response('x'.repeat(1001)), 502],
          [async () => new Response('x', { headers: { 'Content-Length': '1001' } }), 502],
        ];
        for (const [implementation, status] of cases) {
          currentSource = createConversationSource(config, implementation);
          const response = await request('/api/conversations/import', { method: 'POST' });
          assert.equal(response.status, status);
          assert.equal(JSON.stringify(response.body).includes('private-token'), false);
          assert.equal(JSON.stringify(response.body).includes('organizer.invalid'), false);
        }
        currentSource = createConversationSource(config, async (url, options) => {
          const expected = new URL(privateUrl); expected.searchParams.set('group_id', 'DEV');
          assert.equal(url, expected.toString());
          assert.equal(options.redirect, 'error');
          assert.equal(options.headers.Authorization, 'Bearer private-token');
          assert.ok(options.signal);
          return Response.json({ conversations: [record('remote')] });
        });
        assert.equal((await request('/api/conversations/import', { method: 'POST' })).body.data.imported, 1);
        currentSource = createConversationSource({ ...config, ORGANIZER_API_URL: undefined });
        assert.equal((await request('/api/conversations/import', { method: 'POST' })).status, 503);
      });

      let v1;
      let v2;
      let oldEvaluation;
      await t.test('creates official-shaped checklist with 8 criteria, weights, scales and N/A', async () => {
        const response = await request('/api/checklists', { method: 'POST', body });
        assert.equal(response.status, 201);
        v1 = response.body.data;
        assert.equal(v1.version, 1);
        assert.equal(v1.criteria.length, 8);
        assert.equal(v1.criteria.reduce((sum, criterion) => sum + criterion.weight, 0), 100);
        assert.deepEqual(v1.criteria.filter((criterion) => criterion.allowNa).map((criterion) => criterion.key), ['02', '03', '04', '07']);
        assert.deepEqual(v1.criteria[3].scaleSteps.map((step) => step.value), [20, 15, 10, 5, 0]);
        assert.deepEqual(v1.criteria[5].scaleSteps.map((step) => step.value), [10, 7, 4, 0]);
        assert.equal(v1.criteria[7].type, 'flag');
        assert.equal(v1.criteria[7].maxPoints, 0);
        assert.equal(v1.criteria[7].weight, 0);
        assert.deepEqual(v1.instructions, official.instructions);
        assert.equal((await request('/api/checklists', { method: 'POST', body })).status, 409);
        const conversation = await tx.conversation.findUniqueOrThrow({ where: { groupId_externalId: { groupId: 'DEV', externalId: `${prefix}-ru` } } });
        oldEvaluation = await tx.evaluation.create({ data: { conversationId: conversation.id, checklistId: v1.id } });
        await tx.criterionResult.createMany({ data: v1.criteria.map((criterion) => ({
          evaluationId: oldEvaluation.id, checklistId: v1.id, criterionId: criterion.id,
          points: 0, explanation: 'Synthetic regression fixture', evidence: [],
        })) });
        oldEvaluation = await tx.evaluation.update({ where: { id: oldEvaluation.id }, data: { status: 'COMPLETED', completedAt: new Date() }, include: { results: true } });
      });

      await t.test('creates a new version with added/replaced criteria; old version stays unchanged', async () => {
        const updated = structuredClone(body);
        delete updated.key;
        updated.name = 'Synthetic revision';
        updated.criteria[0].weight = 5;
        updated.criteria.push({ ...updated.criteria[0], key: 'custom', name: 'Synthetic extra criterion', weight: 5 });
        updated.criteria[1].description = 'Synthetic replacement description';
        const response = await request(`/api/checklists/${v1.id}`, { method: 'PUT', body: updated });
        assert.equal(response.status, 201);
        v2 = response.body.data;
        assert.equal(v2.version, 2);
        assert.equal(v2.criteria.length, 9);
        assert.notEqual(v2.id, v1.id);
        assert.deepEqual((await request(`/api/checklists/${v1.id}`)).body.data, v1);
        assert.deepEqual(await tx.evaluation.findUniqueOrThrow({ where: { id: oldEvaluation.id }, include: { results: true } }), oldEvaluation);
        assert.equal((await request(`/api/checklists/${v1.id}`, { method: 'PUT', body: updated })).status, 409);
        const listed = await request(`/api/checklists?key=${body.key}&pageSize=1`);
        assert.equal(listed.body.pagination.total, 2);
        assert.equal(listed.body.data.length, 1);
        assert.equal((await request(`/api/checklists/${randomUUID()}`)).status, 404);
      });

      await t.test('rejects invalid types, weights, scales, sections, N/A and weighted flags', async () => {
        const invalid = [
          (value) => value.criteria[0].type = 'unknown',
          (value) => value.criteria[0].weight = -1,
          (value) => value.criteria[0].weight = 9,
          (value) => value.criteria[0].weight = '10',
          (value) => value.criteria[0].weight = 10.001,
          (value) => value.criteria[3].scaleSteps = [{ value: 20, label: 'Only one' }],
          (value) => value.criteria[3].scaleSteps[1].value = 20,
          (value) => value.criteria[3].scaleSteps[2].value = 18,
          (value) => value.criteria[7].weight = 1,
          (value) => value.criteria[7].allowNa = true,
          (value) => value.criteria[1].naCondition = null,
          (value) => value.criteria[0].naCondition = 'Not allowed',
          (value) => value.criteria[0].sectionKey = 'missing',
          (value) => value.criteria[1].key = value.criteria[0].key,
          (value) => value.sections.push(value.sections[0]),
          (value) => value.criteria = [],
        ];
        for (const mutate of invalid) {
          const value = structuredClone(body); value.key += '-invalid'; mutate(value);
          assert.equal((await request('/api/checklists', { method: 'POST', body: value })).status, 400);
        }
      });

      await t.test('database rejects invalid managed configs, wrong totals and changing old versions', async () => {
        const stored = await tx.checklist.findUniqueOrThrow({ where: { id: v1.id }, include: { criteria: true } });
        const criterion = stored.criteria[0];
        await databaseReject(() => tx.checklist.update({ where: { id: stored.id }, data: { name: 'Forbidden' } }), /immutable/i);
        await databaseReject(() => tx.checklistCriterion.create({ data: {
          checklistId: v2.id, key: 'wrong-weight', name: 'Invalid', maxPoints: 1,
          config: { ...criterion.config, type: 'unknown' },
        } }), (error) => error.meta?.driverAdapterError?.cause?.originalCode === '23514');
        await databaseReject(() => tx.checklistCriterion.create({ data: {
          checklistId: v2.id, key: 'legacy-zero', name: 'Invalid legacy zero', maxPoints: 0,
        } }), (error) => error.meta?.driverAdapterError?.cause?.originalCode === '23514');
        // Force deferred triggers while inside the rollback fixture.
        await tx.$executeRawUnsafe('SAVEPOINT deferred_check');
        const parsed = createChecklistSchema.parse(body);
        await tx.checklist.create({ data: {
          key: `${prefix}-wrong-total`, name: 'Synthetic invalid total', version: 1,
          config: { schemaVersion: 1, sections: parsed.sections },
          criteria: { create: { key: 'only', name: 'Only', maxPoints: 1,
            config: { ...criterion.config, type: 'boolean', weight: 5, scaleSteps: [], position: 0, allowNa: false, naCondition: null } } },
        } });
        await assert.rejects(() => tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE'), /weight total/i);
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT deferred_check');
        await tx.$executeRawUnsafe('RELEASE SAVEPOINT deferred_check');
        // All successful fixtures must satisfy deferred constraints too.
        await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      });

      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server = undefined;
      throw rollback;
    }, { timeout: 120000 }), (error) => error === rollback);
    assert.equal(await prisma.checklist.count({ where: { key: { startsWith: prefix } } }), 0);
    assert.equal(await prisma.conversation.count({ where: { externalId: { startsWith: prefix } } }), 0);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});

test('database errors map to safe HTTP responses', async () => {
  const database = { conversation: { findUnique() { throw Object.assign(new Error('private database URL and token'), { code: 'P1001' }); } } };
  const server = createApp({ database }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/conversations/${randomUUID()}`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' } });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PostgreSQL adapter SQLSTATE errors are sanitized without language-dependent matching', async () => {
  for (const [state, expected] of [['23514',400],['23505',409],['23503',409],['3D000',503],['42P01',503],['08006',503]]) {
    const database = { conversation: { findUnique() { throw Object.assign(new Error('secret URL password'), {
      code:'P2039',meta:{driverAdapterError:{cause:{originalCode:state}}},
    }); } } };
    const server = createApp({ database }).listen(0,'127.0.0.1'); await once(server,'listening');
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/conversations/${randomUUID()}`);
      assert.equal(response.status,expected);assert.equal(JSON.stringify(await response.json()).includes('secret'),false);
    } finally { await new Promise(resolve=>server.close(resolve)); }
  }
});

test('a refused PostgreSQL connection returns HTTP 503 without connection details', async () => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const database = new PrismaClient({ adapter: new PrismaPg({
    connectionString: `postgresql://synthetic_user:synthetic_password@127.0.0.1:${port}/cqa_test`,
    connectionTimeoutMillis: 1000,
  }) });
  const server = createApp({ database }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/conversations/${randomUUID()}`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'DATABASE_UNAVAILABLE');
    assert.equal(JSON.stringify(body).includes('synthetic_password'), false);
    assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await database.$disconnect();
  }
});
