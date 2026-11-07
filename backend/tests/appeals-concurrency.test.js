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

// Real committed synthetic fixtures are necessary for visibility across independent
// PostgreSQL connections. They remain only in the dedicated test database.
test('Appeals concurrency uses independent PostgreSQL transactions without lost decisions', async (t) => {
  assert.match(new URL(env.DATABASE_URL).pathname, /test/i, 'Use an isolated test database');
  const official = JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json', import.meta.url), 'utf8'));
  const prefix = `appeal-race-${randomUUID()}`;
  let gate;
  const database = new Proxy(prisma, { get(target, key) {
    if (key === '$transaction') return (action, options) => {
      if (typeof action !== 'function') return target.$transaction(action, options);
      const active = gate;
      return target.$transaction(async (tx) => {
        if (active) {
          const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
          active.pids.add(pid); active.arrivals++;
          if (active.arrivals === 2) active.release();
          await active.ready;
        }
        return action(tx);
      }, options);
    };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const server = createApp({ database }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function race(first, second) {
    let release;
    const ready = new Promise((resolve) => { release = resolve; });
    const active = { ready, release, arrivals: 0, pids: new Set() };
    const timeout = setTimeout(release, 3000);
    gate = active;
    try {
      const results = await Promise.all([first(), second()]);
      assert.equal(active.arrivals, 2); assert.equal(active.pids.size, 2, 'Requests must use two separate backend connections');
      return results;
    } finally { gate = undefined; clearTimeout(timeout); }
  }
  let counter = 0;
  async function fixture() {
    counter++;
    const conversation = await prisma.conversation.create({ data: { externalId: `${prefix}-${counter}`, language: 'EN', channel: 'chat',
      transcript: [{ turnIndex: 0, timestamp: '00:00:01.250', speaker: 'operator', text: 'Synthetic concurrent appeal fixture' }] } });
    const payload = structuredClone(official); payload.key = `${prefix}-${counter}`;
    const checklist = await checklistService(prisma).create(createChecklistSchema.parse(payload));
    const original = (await evaluationService(prisma, createMockAiClient()).create({ conversationId: conversation.id, checklistId: checklist.id })).data;
    return { original, criterionId: (key) => original.results.find((result) => result.criterionKey === key).criterionId };
  }
  const openInput = (fixture, key) => ({ evaluationId: fixture.original.id, criterionId: fixture.criterionId(key), comment: 'Synthetic race test appeal' });
  async function open(fixture, key) {
    const response = await request('/api/appeals', 'POST', openInput(fixture, key)); assert.equal(response.status, 201); return response.body.data;
  }
  const change = (appeal, value) => request(`/api/appeals/${appeal.id}/decision`, 'PATCH', { decision: 'CHANGE', value, reason: 'Synthetic independent concurrent review' });
  try {
    await t.test('simultaneous duplicate creation gives one PENDING appeal and one HTTP 409', async () => {
      const item = await fixture();
      const responses = await race(() => request('/api/appeals', 'POST', openInput(item, '01')), () => request('/api/appeals', 'POST', openInput(item, '01')));
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal(await prisma.appeal.count({ where: { criterionResult: { evaluationId: item.original.id }, status: 'PENDING' } }), 1);
    });

    await t.test('competing decisions on one appeal: only one wins, the other receives 409', async () => {
      const item = await fixture(); const appeal = await open(item, '01');
      const responses = await race(() => change(appeal, true), () => request(`/api/appeals/${appeal.id}/decision`, 'PATCH', { decision: 'CONFIRM', reason: 'Synthetic competing decision' }));
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      const winner = responses.find((response) => response.status === 200).body.data;
      const reopened = await request(`/api/appeals/${appeal.id}`);
      assert.deepEqual(reopened.body.data.afterScore, winner.afterScore);
      assert.equal(reopened.body.data.status, winner.status);
      assert.deepEqual((await request(`/api/evaluations/${item.original.id}`)).body.data, JSON.parse(JSON.stringify(item.original)));
    });

    await t.test('parallel decisions for different criteria include both changes in the final score', async () => {
      const item = await fixture(); const boolean = await open(item, '01'); const scale = await open(item, '04');
      const responses = await race(() => change(boolean, true), () => change(scale, 15));
      assert.ok(responses.every((response) => response.status === 200));
      const snapshots = responses.map((response) => response.body.data.afterScore.total).sort((a, b) => a - b);
      assert.ok(snapshots[0] === 10 || snapshots[0] === 15); assert.equal(snapshots[1], 25);
      const reopened = await request(`/api/appeals/${boolean.id}`);
      assert.equal(reopened.body.data.finalScore.total, 25); assert.equal(reopened.body.data.originalScore.total, 0);
      const changedRows = await prisma.appeal.findMany({ where: { criterionResult: { evaluationId: item.original.id }, status: 'ACCEPTED' } });
      assert.equal(changedRows.length, 2);
      assert.ok(changedRows.some((row) => row.beforeScore.total === 0));
      assert.ok(changedRows.some((row) => row.afterScore.total === 25 && [10, 15].includes(row.beforeScore.total)));
    });

    await t.test('parallel flag and scale changes preserve both grossError and the numerical result', async () => {
      const item = await fixture(); const flag = await open(item, '08'); const scale = await open(item, '04');
      const responses = await race(() => change(flag, true), () => change(scale, 15));
      assert.ok(responses.every((response) => response.status === 200));
      const reopened = await request(`/api/appeals/${flag.id}`);
      assert.equal(reopened.body.data.finalScore.total, 15); assert.equal(reopened.body.data.finalScore.grossError, true);
      assert.equal(reopened.body.data.originalScore.total, 0); assert.equal(reopened.body.data.originalScore.grossError, false);
    });
  } finally {
    if (gate) gate.release();
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
});
