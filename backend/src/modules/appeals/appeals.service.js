import { Prisma } from '@prisma/client';
import { ApiError } from '../../middleware/api-error.js';
import { confirmApplicability } from '../evaluations/applicability.js';
import { serializeChecklist } from '../checklists/checklists.service.js';
import { reviewState, replacementScore } from './appeal-review.js';

const summaryInclude = { criterionResult: { include: { criterion: true } } };

function summary(appeal) {
  const result = appeal.criterionResult;
  return {
    id: appeal.id, evaluationId: result.evaluationId, criterionId: result.criterionId, criterionResultId: result.id,
    comment: appeal.comment, status: appeal.status, decision: appeal.decision,
    reviewer: appeal.reviewer, reason: appeal.decisionReason, createdAt: appeal.createdAt, decidedAt: appeal.decidedAt,
    criterion: { id: result.criterion.id, key: result.criterion.key, name: result.criterion.name, type: result.criterion.config.type ?? null },
  };
}

async function evaluationForReview(tx, id) {
  const evaluation = await tx.evaluation.findUnique({ where: { id } });
  if (!evaluation) throw new ApiError(404, 'EVALUATION_NOT_FOUND', 'Evaluation not found');
  // Keep relation reads sequential on the transaction's one PostgreSQL connection.
  const conversation = await tx.conversation.findUnique({ where: { id: evaluation.conversationId } });
  const checklist = await tx.checklist.findUnique({ where: { id: evaluation.checklistId }, include: { criteria: true } });
  const results = await tx.criterionResult.findMany({ where: { evaluationId: id } });
  const accepted = await tx.appeal.findMany({ where: { criterionResult: { evaluationId: id }, status: 'ACCEPTED' }, orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }] });
  const changes = new Map();
  for (const appeal of accepted) {
    if (!changes.has(appeal.criterionResultId)) changes.set(appeal.criterionResultId, []);
    changes.get(appeal.criterionResultId).push(appeal);
  }
  return { ...evaluation, conversation, checklist, results: results.map((result) => ({ ...result, appeals: changes.get(result.id) ?? [] })) };
}

async function card(tx, id) {
  const appeal = await tx.appeal.findUnique({ where: { id }, include: summaryInclude });
  if (!appeal) throw new ApiError(404, 'APPEAL_NOT_FOUND', 'Appeal not found');
  const evaluation = await evaluationForReview(tx, appeal.criterionResult.evaluationId);
  let state;
  let reviewError = null;
  try { state = reviewState(evaluation); }
  catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'EVALUATION_NOT_REVIEWABLE') throw error;
    reviewError = error.code;
  }
  const result = appeal.criterionResult;
  return {
    ...summary(appeal),
    reviewable: Boolean(state), reviewError,
    originalScore: evaluation.score, finalScore: state?.finalScore ?? null,
    beforeScore: appeal.beforeScore, afterScore: appeal.afterScore,
    originalResult: { answer: result.answer, isNa: result.isNa, naReason: result.naReason,
      rawPoints: result.points === null ? null : Number(result.points), explanation: result.explanation,
      evidence: result.evidence, checkedRange: result.checkedRange },
    currentResult: state?.current.get(result.criterionId) ?? null,
    revisedAnswer: appeal.revisedAnswer, revisedIsNa: appeal.revisedIsNa, revisedNaReason: appeal.revisedNaReason,
    evaluation: { id: evaluation.id, checklistId: evaluation.checklistId, status: evaluation.status,
      provider: evaluation.provider, transport: evaluation.transport, aiResponse: evaluation.aiResponse },
    checklist: state?.checklist ?? serializeChecklist(evaluation.checklist),
    conversation: evaluation.conversation,
  };
}

export function appealService(database) {
  return {
    async create({ evaluationId, criterionId, comment }) {
      return database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Evaluation" WHERE id = ${evaluationId}::uuid FOR UPDATE`;
        const evaluation = await evaluationForReview(tx, evaluationId);
        if (evaluation.status !== 'COMPLETED') throw new ApiError(409, 'EVALUATION_NOT_COMPLETED', 'Only completed evaluations can be appealed');
        const result = evaluation.results.find((item) => item.criterionId === criterionId);
        if (!result) throw new ApiError(404, 'CRITERION_RESULT_NOT_FOUND', 'Criterion result does not belong to this evaluation');
        reviewState(evaluation);
        if (await tx.appeal.findFirst({ where: { criterionResultId: result.id, status: 'PENDING' } })) {
          throw new ApiError(409, 'APPEAL_ALREADY_PENDING', 'A pending appeal already exists for this criterion result');
        }
        const appeal = await tx.appeal.create({ data: { criterionResultId: result.id, comment } });
        return card(tx, appeal.id);
      }, { timeout: 10000 });
    },
    async list({ page, pageSize, status }) {
      const where = status ? { status } : {};
      const [total, rows] = await database.$transaction([
        database.appeal.count({ where }),
        database.appeal.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: summaryInclude }),
      ], { isolationLevel: 'RepeatableRead' });
      return { data: rows.map(summary), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
    },
    async get(id) {
      // One consistent snapshot for the appeal, context and all accepted changes.
      return database.$transaction((tx) => card(tx, id), { isolationLevel: 'RepeatableRead', timeout: 10000 });
    },
    async decide(id, input) {
      return database.$transaction(async (tx) => {
        const target = await tx.appeal.findUnique({ where: { id }, select: { criterionResult: { select: { evaluationId: true } } } });
        if (!target) throw new ApiError(404, 'APPEAL_NOT_FOUND', 'Appeal not found');
        const evaluationId = target.criterionResult.evaluationId;
        // Serialize ALL decisions for one evaluation, including different criteria.
        await tx.$queryRaw`SELECT id FROM "Evaluation" WHERE id = ${evaluationId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Appeal" WHERE id = ${id}::uuid FOR UPDATE`;
        const appeal = await tx.appeal.findUnique({ where: { id }, include: summaryInclude });
        if (appeal.status !== 'PENDING') throw new ApiError(409, 'APPEAL_ALREADY_DECIDED', 'Appeal has already been decided');
        const evaluation = await evaluationForReview(tx, evaluationId);
        const state = reviewState(evaluation);
        const result = appeal.criterionResult;
        const criterion = state.checklist.criteria.find((item) => item.key === result.criterion.key);
        let finalScore = state.finalScore;
        let revised = {};
        if (input.decision === 'CHANGE') {
          let answer;
          if (input.isNa) {
            if (!criterion.allowNa || criterion.type === 'flag') throw new ApiError(422, 'NA_NOT_ALLOWED', 'Criterion does not allow N/A');
            const confirmations = await tx.applicabilityConfirmation.findMany({ where: { conversationId: evaluation.conversationId, checklistId: evaluation.checklistId } });
            if (!confirmApplicability(criterion, evaluation.conversation, state.checklist, confirmations, Boolean(input.naReason))) {
              throw new ApiError(422, 'NA_CONDITION_UNCONFIRMED', 'N/A requires an independent confirmation for this version and conversation');
            }
            answer = { criterionKey: criterion.key, isNa: true, naConditionMet: true, naReason: input.naReason };
          } else answer = { criterionKey: criterion.key, value: input.value };
          finalScore = replacementScore(state, result.criterionId, answer);
          revised = {
            revisedIsNa: input.isNa, revisedAnswer: input.isNa ? Prisma.JsonNull : input.value,
            revisedNaReason: input.isNa ? input.naReason : null,
            revisedPoints: input.isNa ? null : criterion.type === 'flag' ? 0 : criterion.type === 'boolean' ? (input.value ? 1 : 0) : input.value,
          };
        }
        const changed = await tx.appeal.updateMany({ where: { id, status: 'PENDING' }, data: {
          status: input.decision === 'CHANGE' ? 'ACCEPTED' : 'REJECTED', decision: input.decision,
          reviewer: input.reviewer, decisionReason: input.reason,
          beforeScore: state.finalScore, afterScore: finalScore, ...revised,
        } });
        if (changed.count !== 1) throw new ApiError(409, 'APPEAL_ALREADY_DECIDED', 'Appeal has already been decided');
        return card(tx, id);
      }, { isolationLevel: 'ReadCommitted', timeout: 10000 });
    },
  };
}
