import { ApiError } from '../../middleware/api-error.js';
import { serializeChecklist } from '../checklists/checklists.service.js';
import { parseChecklist } from '../scoring/scoring.schema.js';
import { calculateScore, SCORING_VERSION, ScoringError } from '../scoring/scoring.service.js';

function unsupported() {
  throw new ApiError(409, 'EVALUATION_NOT_REVIEWABLE', 'Original typed answers or compatible scoring snapshots are unavailable');
}

export function reviewState(evaluation) {
  if (evaluation.status !== 'COMPLETED') throw new ApiError(409, 'EVALUATION_NOT_COMPLETED', 'Only completed evaluations can be appealed');
  if (!evaluation.score || evaluation.score.scoringVersion !== SCORING_VERSION) unsupported();
  try {
    const checklist = parseChecklist(serializeChecklist(evaluation.checklist));
    const byKey = new Map(checklist.criteria.map((criterion) => [criterion.key, criterion]));
    const keyById = new Map(evaluation.checklist.criteria.map((criterion) => [criterion.id, criterion.key]));
    const current = new Map();
    for (const result of evaluation.results) {
      const criterion = byKey.get(keyById.get(result.criterionId));
      if (!criterion) unsupported();
      if (!result.isNa && !['boolean', 'number'].includes(typeof result.answer)) unsupported();
      if (result.isNa && !result.naReason?.trim()) unsupported();
      const original = result.isNa
        ? { criterionKey: criterion.key, isNa: true, naConditionMet: true, naReason: result.naReason }
        : { criterionKey: criterion.key, value: result.answer };
      const latest = result.appeals[0];
      if (latest) {
        if (latest.decision !== 'CHANGE' || typeof latest.revisedIsNa !== 'boolean'
          || (!latest.revisedIsNa && !['boolean', 'number'].includes(typeof latest.revisedAnswer))
          || (latest.revisedIsNa && !latest.revisedNaReason?.trim())) unsupported();
        current.set(result.criterionId, latest.revisedIsNa
          ? { criterionKey: criterion.key, isNa: true, naConditionMet: true, naReason: latest.revisedNaReason }
          : { criterionKey: criterion.key, value: latest.revisedAnswer });
      } else current.set(result.criterionId, original);
    }
    const finalScore = calculateScore(checklist, [...current.values()]);
    return { checklist, current, originalScore: evaluation.score, finalScore };
  } catch (error) {
    if (error instanceof ScoringError) unsupported();
    throw error;
  }
}

export function replacementScore(state, criterionId, answer) {
  const updated = new Map(state.current);
  updated.set(criterionId, answer);
  try { return calculateScore(state.checklist, [...updated.values()]); }
  catch (error) {
    if (error instanceof ScoringError) throw new ApiError(400, 'INVALID_REVIEW_VALUE', 'New answer does not match the saved checklist version', [{ code: error.code }]);
    throw error;
  }
}
