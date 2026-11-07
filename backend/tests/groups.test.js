import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env.js';
import { prisma } from '../src/database/client.js';
import { createApp } from '../src/app.js';
import { createConversationSource } from '../src/modules/conversations/organizer-client.js';
import { exportGroupId, groupIdSchema, legacyGroupId } from '../src/modules/conversations/groups.js';
import { organizerRecords } from '../src/modules/conversations/organizer-payload.js';
import { readFile } from 'node:fs/promises';
import { checklistService } from '../src/modules/checklists/checklists.service.js';
import { createChecklistSchema } from '../src/modules/checklists/checklists.schema.js';
import { evaluationService } from '../src/modules/evaluations/evaluations.service.js';
import { createMockAiClient } from '../src/ai-client/mock-client.js';
import { readExportEvaluations } from '../src/modules/exports/selection.js';
import { createOfficialResults, mockModel } from '../src/modules/exports/official-results.js';

const sourceConfig = { IMPORT_SOURCE: 'organizers', ORGANIZER_API_URL: 'https://organizer.invalid/fixed?token=synthetic-secret&group_id=DEV',
  IMPORT_MAX_RECORDS: 500, IMPORT_MAX_BYTES: 100000, IMPORT_TIMEOUT_MS: 1000 };

test('group IDs are bounded opaque identifiers, never URLs or query fragments', () => {
  for (const id of ['DEV', 'control', 'team_42', randomUUID()]) assert.equal(groupIdSchema.parse(id), id);
  for (const id of ['', ' DEV', 'DEV ', 'a b', '__legacy__', 'a'.repeat(201), 'https://evil.invalid', '../DEV', 'DEV&token=x', 'DEV#x', 'DEV%26x', 'DEV\n', [], null, 12]) {
    assert.equal(groupIdSchema.safeParse(id).success, false);
  }
});

test('organizer group selection preserves fixed destination/secrets and checks response identity', async () => {
  const load = createConversationSource(sourceConfig, async (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://organizer.invalid'); assert.equal(url.pathname, '/fixed');
    assert.equal(url.searchParams.get('token'), 'synthetic-secret');
    assert.deepEqual(url.searchParams.getAll('group_id'), ['control_42']);
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'GET');
    return Response.json({ isSuccess: true, data: { dataset_group_id: 'control_42', total_records: 0, records: [] } });
  });
  assert.deepEqual(await load('control_42'), []);
  let called = false;
  const unsafe = createConversationSource(sourceConfig, async () => { called = true; });
  await assert.rejects(unsafe('https://evil.invalid')); assert.equal(called, false);
  for (const group of ['DEV', undefined, null]) {
    const wrong = createConversationSource(sourceConfig, async () => Response.json({ isSuccess: true,
      data: { dataset_group_id: group, total_records: 0, records: [] } }));
    await assert.rejects(wrong('control_42'), error => error.status === 502 && error.code === 'UPSTREAM_GROUP_MISMATCH');
  }
});

test('built-in mock never fabricates an organizer control dataset', async () => {
  const source = createConversationSource({ IMPORT_SOURCE: 'mock' });
  assert.ok((await source('DEV')).length > 0);
  await assert.rejects(source('control'), error => error.status === 503 && error.code === 'MOCK_GROUP_UNAVAILABLE');
});

test('export split binds the manifest to exactly one organizer group', () => {
  const source = { data: { dataset_group_id: 'control_42' } };
  assert.equal(exportGroupId(source, undefined, 'prod'), 'control_42');
  assert.equal(exportGroupId({}, 'control_42', 'prod'), 'control_42');
  assert.equal(exportGroupId({}, undefined, 'dev'), 'DEV');
  for (const args of [[source, 'DEV', 'prod'], [source, undefined, 'dev'], [{}, 'DEV', 'prod'], [{}, undefined, 'prod'], [{}, '__legacy__', 'prod']]) {
    assert.throws(() => exportGroupId(...args));
  }
  assert.throws(() => organizerRecords({ isSuccess: true, data: { dataset_group_id: 'DEV', total_records: 0, records: [] } }, 500, 'control_42'),
    error => error.code === 'UPSTREAM_GROUP_MISMATCH');
});

test('T02 real HTTP/PostgreSQL: same organizer ID stays isolated and idempotent per group', async t => {
  assert.match(new URL(env.DATABASE_URL).pathname, /test/i, 'Use an isolated test database');
  const prefix = 'groups-' + randomUUID();
  const second = 'test_' + randomUUID();
  const original = { conversation_id: prefix, language: 'RU', channel: 'voice call', audio_url: null,
    transcript: [{ turnIndex: 0, speaker: 'operator', timestamp: '2026-01-01T10:00:00.1234567+06:00', text: 'Synthetic DEV sample', startMs: '001.250' }] };
  const alternative = { ...structuredClone(original), language: 'EN', channel: 'agent chat' };
  alternative.transcript[0].text = 'Synthetic second group sample';
  const batches = new Map([['DEV', [original]], [second, [alternative, alternative]]]);
  let responseGroup;
  const load = createConversationSource(sourceConfig, async address => {
    const id = new URL(address).searchParams.get('group_id');
    const records = batches.get(id) ?? [];
    return Response.json({ isSuccess: true, data: { dataset_group_id: responseGroup ?? id, total_records: records.length, records } });
  });
  let server;
  const rollback = new Error('ROLLBACK_GROUP_FIXTURES');
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const database = new Proxy(tx, { get(target, key) {
        if (key === '$transaction') return async action => typeof action === 'function' ? action(tx) : Promise.all(action);
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      server = createApp({ database, loadConversations: load }).listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      const request = async (path, body) => {
        const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      };
      const legacy = await tx.conversation.create({ data: { externalId: prefix, language: original.language,
        channel: original.channel, transcript: original.transcript } });
      assert.equal(legacy.groupId, legacyGroupId);
      let dev, other;
      await t.test('DEV default and explicit group import use the organizer GET query', async () => {
        assert.equal((await request('/api/conversations/import', {})).body.data.groupId, 'DEV');
        const imported = await request('/api/conversations/import', { group_id: second });
        assert.equal(imported.status, 200); assert.equal(imported.body.data.groupId, second);
        assert.equal(imported.body.data.imported, 1); assert.equal(imported.body.data.duplicates, 1);
        dev = await tx.conversation.findUniqueOrThrow({ where: { groupId_externalId: { groupId: 'DEV', externalId: prefix } } });
        other = await tx.conversation.findUniqueOrThrow({ where: { groupId_externalId: { groupId: second, externalId: prefix } } });
        assert.notEqual(dev.id, other.id); assert.equal(dev.externalId, other.externalId);
        assert.notEqual(legacy.id, dev.id); assert.notEqual(legacy.id, other.id);
        assert.deepEqual(await tx.conversation.findUniqueOrThrow({ where: { id: legacy.id } }), legacy);
      });
      await t.test('repeat import never overwrites either group or original source fields', async () => {
        for (const group of ['DEV', second]) {
          const again = await request('/api/conversations/import', { group_id: group });
          assert.equal(again.body.data.imported, 0);
        }
        batches.set(second, [{ ...alternative, channel: 'changed source channel' }]);
        assert.equal((await request('/api/conversations/import', { group_id: second })).body.data.imported, 0);
        for (const [stored, source] of [[dev, original], [other, alternative]]) {
          const card = await request('/api/conversations/' + stored.id);
          assert.equal(card.status, 200); assert.equal(card.body.data.externalId, source.conversation_id);
          assert.equal(card.body.data.channel, source.channel); assert.deepEqual(card.body.data.transcript, source.transcript);
        }
      });
      await t.test('group filtering composes with language, channel and pagination', async () => {
        const filtered = await request('/api/conversations?group_id=' + second + '&language=EN&channel=agent%20chat&pageSize=1');
        assert.equal(filtered.status, 200); assert.equal(filtered.body.pagination.total, 1);
        assert.equal(filtered.body.data[0].id, other.id); assert.equal(filtered.body.data[0].groupId, second);
        assert.equal((await request('/api/conversations?group_id=' + second + '&page=2&pageSize=1')).body.data.length, 0);
        assert.equal((await request('/api/conversations?group_id=' + second + '&language=RU')).body.pagination.total, 0);
        assert.ok((await request('/api/conversations?group_id=DEV')).body.data.every(row => row.groupId === 'DEV'));
      });
      await t.test('wrong upstream group is 502 and never adds or changes records', async () => {
        responseGroup = 'DEV';
        try {
          const before = await tx.conversation.findMany({ where: { externalId: prefix }, orderBy: { id: 'asc' } });
          const response = await request('/api/conversations/import', { group_id: second });
          assert.equal(response.status, 502); assert.equal(response.body.error.code, 'UPSTREAM_GROUP_MISMATCH');
          assert.equal(JSON.stringify(response.body).includes('synthetic-secret'), false);
          assert.deepEqual(await tx.conversation.findMany({ where: { externalId: prefix }, orderBy: { id: 'asc' } }), before);
        } finally { responseGroup = undefined; }
      });
      await t.test('invalid group/unknown fields are 400; no unnecessary groups endpoint is added', async () => {
        for (const id of ['', ' DEV', 'a&b', '__legacy__', 'a'.repeat(201), null, 12]) {
          assert.equal((await request('/api/conversations/import', { group_id: id })).status, 400);
        }
        for (const value of ['', 'https://evil.invalid', 'a&b']) {
          assert.equal((await request('/api/conversations?group_id=' + encodeURIComponent(value))).status, 400);
        }
        assert.equal((await request('/api/conversations/import?group_id=DEV', {})).status, 400);
        assert.equal((await request('/api/conversations/import', { group_id: second, url: 'https://evil.invalid' })).status, 400);
        assert.equal((await request('/api/groups', {})).status, 404);
      });
      await t.test('database enforces group/ID uniqueness and immutable provenance', async () => {
        for (const action of [
          () => tx.conversation.create({ data: { externalId: prefix, groupId: second, language: alternative.language,
            channel: alternative.channel, transcript: alternative.transcript } }),
          () => tx.conversation.update({ where: { id: other.id }, data: { groupId: 'DEV' } }),
          () => tx.conversation.create({ data: { externalId: prefix + '-invalid', groupId: 'bad group', language: 'RU', channel: 'chat', transcript: [] } }),
        ]) {
          await tx.$executeRawUnsafe('SAVEPOINT group_constraint');
          try { await assert.rejects(action); }
          finally { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT group_constraint'); await tx.$executeRawUnsafe('RELEASE SAVEPOINT group_constraint'); }
        }
      });
      await t.test('production export selector reads one group only and never substitutes the other saved score', async () => {
        const official = JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json', import.meta.url), 'utf8'));
        const checklist = await checklistService(database).create(createChecklistSchema.parse({ ...official, key: prefix }));
        const scorer = evaluationService(database, createMockAiClient());
        const first = (await scorer.create({ conversationId: dev.id, checklistId: checklist.id })).data;
        const old = (await scorer.create({ conversationId: legacy.id, checklistId: checklist.id })).data;
        const changedScorer = evaluationService(database, createMockAiClient({ overrides: { '05': { answer: true } } }));
        const secondScore = (await changedScorer.create({ conversationId: other.id, checklistId: checklist.id })).data;
        assert.notEqual(first.score.total, secondScore.score.total);
        for (const [conversation, saved] of [[dev, first], [other, secondScore]]) {
          const rows = await readExportEvaluations(tx, checklist.id, conversation.groupId, [conversation]);
          assert.equal(rows.length, 1); assert.equal(rows[0].id, saved.id);
          // One-record unit fixture, not a fabricated ten-record PROD dataset/file.
          const rawChecklist = await tx.checklist.findUniqueOrThrow({ where: { id: checklist.id }, include: { criteria: true } });
          const file = createOfficialResults({ teamName: 'SYNTHETIC GROUP ISOLATION TEST', model: mockModel,
            manifest: [conversation], evaluations: rows, checklist: rawChecklist, expectedCount: 1,
            groupId: conversation.groupId, allowMock: true });
          assert.equal(file.results[0].conversation_id, prefix); assert.equal(file.results[0].score.final_score, saved.score.total);
          assert.deepEqual(await readExportEvaluations(tx, checklist.id, 'nonexistent_test_group', [conversation]), []);
        }
        await request('/api/conversations/import', { group_id: second });
        assert.deepEqual((await scorer.get(first.id)).score, first.score);
        assert.deepEqual((await scorer.get(secondScore.id)).score, secondScore.score);
        assert.deepEqual((await scorer.get(old.id)).score, old.score);
      });
      throw rollback;
    }, { timeout: 30000 }), error => error === rollback);
  } finally { await new Promise(resolve => server ? server.close(resolve) : resolve()); await prisma.$disconnect(); }
});
