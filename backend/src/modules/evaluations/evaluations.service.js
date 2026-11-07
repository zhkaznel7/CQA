import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../middleware/api-error.js';
import { serializeChecklist } from '../checklists/checklists.service.js';
import { parseChecklist } from '../scoring/scoring.schema.js';
import { calculateScore, ScoringError } from '../scoring/scoring.service.js';
import { buildAiRequest, validateAiResponse } from './ai-contract.js';

const include = { results: { orderBy: { criterion: { key: 'asc' } }, include: { criterion: { select: { key: true } } } } };
function serialize(row) {
  return {
    id: row.id, conversationId: row.conversationId, checklistId: row.checklistId,
    status: row.status, provider: row.provider, transport: row.transport,
    isMock: row.provider === 'mock', createdAt: row.createdAt, completedAt: row.completedAt,
    score: row.score, aiResponse: row.aiResponse,
    results: row.results.map((result) => ({ id: result.id, criterionId: result.criterionId,
      criterionKey: result.criterion.key, answer: result.answer, isNa: result.isNa, naReason: result.naReason,
      rawPoints: result.points === null ? null : Number(result.points), explanation: result.explanation,
      evidence: result.evidence, checkedRange: result.checkedRange })),
  };
}

function completed(row) {
  if (row.status !== 'COMPLETED') throw new ApiError(409, 'EVALUATION_EXISTS', 'An unfinished evaluation already exists for this pair');
  return { data: serialize(row), created: false };
}

export function evaluationService(database, aiClient) {
  return {
    async get(id) {
      const row = await database.evaluation.findUnique({ where: { id }, include });
      if (!row) throw new ApiError(404, 'EVALUATION_NOT_FOUND', 'Evaluation not found');
      return serialize(row);
    },
    async create({ conversationId, checklistId }) {
      const where = { conversationId_checklistId: { conversationId, checklistId } };
      const existing = await database.evaluation.findUnique({ where, include });
      if (existing) return completed(existing);
      const [conversation, row] = await Promise.all([
        database.conversation.findUnique({ where: { id: conversationId } }),
        database.checklist.findUnique({ where: { id: checklistId }, include: { criteria: true } }),
      ]);
      if (!conversation) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
      if (!row) throw new ApiError(404, 'CHECKLIST_NOT_FOUND', 'Checklist not found');
      let checklist;
      try { checklist = parseChecklist(serializeChecklist(row)); }
      catch (error) {
        if (error instanceof ScoringError) throw new ApiError(422, 'CHECKLIST_NOT_SCORABLE', 'Checklist version has no valid scoring configuration');
        throw error;
      }
      const request = buildAiRequest(conversation, checklist);
      const payload = await aiClient.evaluate(request);
      const confirmations = await database.applicabilityConfirmation.findMany({ where: { conversationId, checklistId } });
      const { response, answers } = validateAiResponse(payload, conversation, checklist, confirmations);
      const score = calculateScore(checklist, answers);

      // No HTTP/AI calls inside a database transaction. Recheck immutable inputs under locks.
      return database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id = ${conversationId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Checklist" WHERE id = ${checklistId}::uuid FOR UPDATE`;
        const concurrent = await tx.evaluation.findUnique({ where, include });
        if (concurrent) return completed(concurrent);
        const currentConversation = await tx.conversation.findUnique({ where: { id: conversationId } });
        const currentChecklist = await tx.checklist.findUnique({ where: { id: checklistId }, include: { criteria: true } });
        if (!currentConversation || !currentChecklist
          || currentConversation.channel !== conversation.channel || currentConversation.language !== conversation.language
          || !isDeepStrictEqual(currentConversation.transcript, conversation.transcript)
          || !isDeepStrictEqual(buildAiRequest(currentConversation, parseChecklist(serializeChecklist(currentChecklist))), request)) {
          throw new ApiError(409, 'EVALUATION_INPUT_CHANGED', 'Conversation or checklist changed during AI processing; retry');
        }
        const evaluation = await tx.evaluation.create({ data: {
          conversationId, checklistId, provider: aiClient.source, transport: aiClient.transport, score, aiResponse: response,
        } });
        const criteria = new Map(row.criteria.map((criterion) => [criterion.key, criterion]));
        await tx.criterionResult.createMany({ data: response.results.map((result) => {
          const criterion = criteria.get(result.criterion_id);
          const type = checklist.criteria.find((item) => item.key === criterion.key).type;
          return {
            evaluationId: evaluation.id, checklistId, criterionId: criterion.id,
            points: result.na ? null : type === 'flag' ? 0 : type === 'boolean' ? (result.answer ? 1 : 0) : result.answer,
            answer: result.answer === null ? Prisma.JsonNull : result.answer,
            isNa: result.na, naReason: result.na_reason, explanation: result.explanation,
            evidence: result.evidence, checkedRange: result.checked_range ?? Prisma.DbNull,
          };
        }) });
        const saved = await tx.evaluation.update({ where: { id: evaluation.id }, data: { status: 'COMPLETED', completedAt: new Date() }, include });
        return { data: serialize(saved), created: true };
      }, { timeout: 10000 });
    },
  };
}
