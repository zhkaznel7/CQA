import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../src/database/client.js';
import { env } from '../src/config/env.js';

// Every fixture and mutation is rolled back; use a dedicated migrated test DB.
test('database integrity, checklist versions and appeal history', async (t) => {
  assert.match(new URL(env.DATABASE_URL).pathname, /test/i, 'Use a dedicated test database');
  const rollback = new Error('ROLLBACK_TEST_FIXTURE');
  const externalId = `test-${randomUUID()}`;
  try {
    await assert.rejects(prisma.$transaction(async (db) => {
      async function rejected(action, pattern) {
        await db.$executeRawUnsafe('SAVEPOINT expected_rejection');
        try { await assert.rejects(action, pattern); }
        finally {
          await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_rejection');
          await db.$executeRawUnsafe('RELEASE SAVEPOINT expected_rejection');
        }
      }

      const conversation = await db.conversation.create({ data: {
        externalId, language: 'RU', channel: 'voice',
        transcript: [{ speaker: 'operator', text: 'Здравствуйте' }, { speaker: 'client', text: 'Добрый день' }],
      } });
      const checklist = await db.checklist.create({ data: {
        key: externalId, name: 'Test checklist', version: 1,
        criteria: { create: [
          { key: 'greeting', name: 'Greeting', maxPoints: 10 },
          { key: 'optional', name: 'Optional', maxPoints: 5 },
        ] },
      }, include: { criteria: true } });
      const criterion = checklist.criteria.find((item) => item.key === 'greeting');
      const optional = checklist.criteria.find((item) => item.key === 'optional');
      const version2 = await db.checklist.create({ data: {
        key: externalId, name: 'Test checklist v2', version: 2,
        criteria: { create: { key: 'greeting', name: 'Greeting v2', maxPoints: 20 } },
      }, include: { criteria: true } });
      const evaluation = await db.evaluation.create({ data: {
        conversationId: conversation.id, checklistId: checklist.id,
      } });
      const resultData = {
        evaluationId: evaluation.id, checklistId: checklist.id, criterionId: criterion.id,
        points: 6, explanation: 'Greeting found', evidence: [{ turnIndex: 0, quote: 'Здравствуйте' }],
      };

      await t.test('duplicate imports, checklist versions and evaluations are rejected', async () => {
        await rejected(() => db.conversation.create({ data: {
          externalId, language: 'EN', channel: 'chat', transcript: [],
        } }), /Unique constraint/i);
        await rejected(() => db.checklist.create({ data: {
          key: externalId, name: 'Duplicate', version: 1,
        } }), /Unique constraint/i);
        await rejected(() => db.evaluation.create({ data: {
          conversationId: conversation.id, checklistId: checklist.id,
        } }), /Unique constraint/i);
        assert.equal(await db.checklist.count({ where: { key: externalId } }), 2);
      });

      await t.test('RU, KZ and EN are stored', async () => {
        for (const language of ['KZ', 'EN']) {
          const row = await db.conversation.create({ data: {
            externalId: `${externalId}-${language}`, language, channel: 'chat', transcript: [],
          } });
          assert.equal(row.language, language);
        }
      });

      await t.test('versions and evaluated transcripts cannot be changed', async () => {
        await rejected(() => db.checklist.update({ where: { id: checklist.id }, data: { name: 'Changed' } }), /immutable/i);
        await rejected(() => db.checklistCriterion.update({ where: { id: criterion.id }, data: { maxPoints: 100 } }), /immutable/i);
        await rejected(() => db.checklistCriterion.create({ data: {
          checklistId: checklist.id, key: 'late', name: 'Late', maxPoints: 1,
        } }), /Cannot add criteria/i);
        await rejected(() => db.conversation.update({ where: { id: conversation.id }, data: { transcript: [] } }), /immutable/i);
      });

      await t.test('incomplete evaluation cannot be completed or appealed', async () => {
        await rejected(() => db.evaluation.update({ where: { id: evaluation.id }, data: {
          status: 'COMPLETED', completedAt: new Date(),
        } }), /Completion requires/i);
        const temporary = await db.criterionResult.create({ data: resultData });
        await rejected(() => db.appeal.create({ data: {
          criterionResultId: temporary.id, comment: 'Too early',
        } }), /completed evaluation/i);
        await db.criterionResult.delete({ where: { id: temporary.id } });
      });

      await t.test('criterion version, score range, N/A and evidence indices are checked', async () => {
        await rejected(() => db.criterionResult.create({ data: {
          ...resultData, criterionId: version2.criteria[0].id,
        } }), /Foreign key constraint/i);
        await rejected(() => db.criterionResult.create({ data: { ...resultData, points: 11 } }), /exceed/i);
        await rejected(() => db.criterionResult.create({ data: { ...resultData, isNa: true } }),
          (error) => error.meta?.driverAdapterError?.cause?.originalCode === '23514');
        for (const evidence of [[{ turnIndex: 2 }], [{ turnIndex: -1 }], [{ turnIndex: 0.5 }], [{}]]) {
          await rejected(() => db.criterionResult.create({ data: { ...resultData, evidence } }), /Evidence/i);
        }
      });

      const result = await db.criterionResult.create({ data: resultData });
      await db.criterionResult.create({ data: {
        evaluationId: evaluation.id, checklistId: checklist.id, criterionId: optional.id,
        isNa: true, points: null, explanation: 'Not applicable',
      } });
      await db.evaluation.update({ where: { id: evaluation.id }, data: {
        status: 'COMPLETED', completedAt: new Date(),
      } });

      async function totals() {
        const [row] = await db.$queryRaw`SELECT * FROM "EvaluationTotals" WHERE "evaluationId" = ${evaluation.id}::uuid`;
        return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'evaluationId').map(([key, value]) => [key, Number(value)]));
      }

      await t.test('completed source results cannot be overwritten or removed', async () => {
        await rejected(() => db.criterionResult.update({ where: { id: result.id }, data: { points: 9 } }), /immutable/i);
        await rejected(() => db.criterionResult.delete({ where: { id: result.id } }), /immutable/i);
        await rejected(() => db.evaluation.update({ where: { id: evaluation.id }, data: { status: 'DRAFT', completedAt: null } }), /immutable/i);
        assert.deepEqual(await totals(), { originalPoints: 6, originalMaxPoints: 10, effectivePoints: 6, effectiveMaxPoints: 10 });
      });

      await t.test('pending and rejected appeals do not change effective points', async () => {
        const appeal = await db.appeal.create({ data: { criterionResultId: result.id, comment: 'Please review' } });
        await rejected(() => db.appeal.create({ data: { criterionResultId: result.id, comment: 'Duplicate pending' } }), /Unique constraint/i);
        assert.equal((await totals()).effectivePoints, 6);
        await db.appeal.update({ where: { id: appeal.id }, data: {
          status: 'REJECTED', reviewer: 'reviewer-1', decisionReason: 'Original result confirmed',
        } });
        assert.equal((await totals()).effectivePoints, 6);
      });

      await t.test('accepted appeals preserve originals; the latest decision wins, including N/A', async () => {
        const appeal = await db.appeal.create({ data: { criterionResultId: result.id, comment: 'More evidence' } });
        await rejected(() => db.appeal.update({ where: { id: appeal.id }, data: {
          status: 'ACCEPTED', reviewer: 'reviewer-1', decisionReason: 'Update', revisedIsNa: false, revisedPoints: 11,
        } }), /exceed/i);
        await db.appeal.update({ where: { id: appeal.id }, data: {
          status: 'ACCEPTED', reviewer: 'reviewer-1', decisionReason: 'Evidence confirmed', revisedIsNa: false, revisedPoints: 9,
        } });
        assert.deepEqual(await totals(), { originalPoints: 6, originalMaxPoints: 10, effectivePoints: 9, effectiveMaxPoints: 10 });
        await rejected(() => db.appeal.update({ where: { id: appeal.id }, data: { revisedPoints: 7 } }), /cannot be overwritten/i);
        await rejected(() => db.appeal.delete({ where: { id: appeal.id } }), /cannot be overwritten/i);
        await db.appeal.create({ data: {
          criterionResultId: result.id, comment: 'Criterion does not apply', status: 'ACCEPTED',
          reviewer: 'reviewer-2', decisionReason: 'Marked N/A', revisedIsNa: true,
        } });
        assert.deepEqual(await totals(), { originalPoints: 6, originalMaxPoints: 10, effectivePoints: 0, effectiveMaxPoints: 0 });
        assert.equal(Number((await db.criterionResult.findUniqueOrThrow({ where: { id: result.id } })).points), 6);
      });
      throw rollback;
    }, { timeout: 60000 }), (error) => error === rollback);
    assert.equal(await prisma.conversation.count({ where: { externalId: { startsWith: externalId } } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});
