import { ApiError } from '../../middleware/api-error.js';
import { aiResponseSchema } from './evaluations.schema.js';
import { confirmApplicability } from './applicability.js';

export function buildAiRequest(conversation, checklist) {
  if (!Array.isArray(conversation.transcript) || !conversation.transcript.length
    || conversation.transcript.some((turn, index) => !turn || typeof turn.text !== 'string' || !turn.text.trim()
      || typeof turn.speaker !== 'string' || !turn.speaker.trim() || (turn.turnIndex !== undefined && turn.turnIndex !== index))) {
    throw new ApiError(422, 'INVALID_TRANSCRIPT', 'Conversation has no valid indexed transcript');
  }
  return {
    conversation_id: conversation.id, channel: conversation.channel, language: conversation.language,
    transcript: conversation.transcript.map((turn, turnIndex) => ({ turnIndex,
      timestamp: turn.timestamp ?? turn.startMs ?? null, speaker: turn.speaker, text: turn.text })),
    checklist: {
      id: checklist.id, key: checklist.key, version: checklist.version, name: checklist.name,
      instructions: checklist.instructions, sections: checklist.sections,
      criteria: checklist.criteria.map((criterion) => ({
        key: criterion.key, name: criterion.name, type: criterion.type, description: criterion.description,
        sectionKey: criterion.sectionKey, weight: criterion.weight, scaleSteps: criterion.scaleSteps,
        allowNa: criterion.allowNa, naCondition: criterion.naCondition,
      })),
    },
  };
}

function invalid(code, message) { throw new ApiError(502, code, message); }

export function validateAiResponse(payload, conversation, checklist, confirmations) {
  const parsed = aiResponseSchema.safeParse(payload);
  if (!parsed.success) invalid('AI_INVALID_RESPONSE', 'AI response does not match the agreed contract');
  const response = parsed.data;
  if (response.conversation_id !== conversation.id || response.checklist_id !== checklist.id || response.checklist_version !== checklist.version) {
    invalid('AI_IDENTITY_MISMATCH', 'AI response references a different conversation or checklist');
  }
  const byKey = new Map(checklist.criteria.map((criterion) => [criterion.key, criterion]));
  const seen = new Set();
  const answers = [];
  for (const result of response.results) {
    const criterion = byKey.get(result.criterion_id);
    if (!criterion || seen.has(result.criterion_id)) invalid('AI_CRITERIA_MISMATCH', 'AI response has unknown or duplicate criteria');
    seen.add(result.criterion_id);
    const range = result.checked_range;
    if (range && (range.start > range.end || range.end >= conversation.transcript.length)) {
      invalid('AI_INVALID_RANGE', 'AI checked range is outside the transcript');
    }
    for (const evidence of result.evidence) {
      const turn = conversation.transcript[evidence.turnIndex];
      if (!turn || !turn.text.includes(evidence.quote)
        || (range && (evidence.turnIndex < range.start || evidence.turnIndex > range.end))) {
        invalid('AI_INVALID_EVIDENCE', 'AI evidence does not match the referenced transcript turn');
      }
    }
    if (!result.evidence.length && !range) invalid('AI_MISSING_SUPPORT', 'AI must provide evidence or an explicitly checked range');
    if (result.na) {
      if (result.answer !== null || !result.na_reason?.trim()) invalid('AI_INVALID_NA', 'N/A requires a null answer and a reason');
      if (!confirmApplicability(criterion, conversation, checklist, confirmations)) {
        invalid('AI_NA_UNCONFIRMED', 'N/A condition is not independently confirmed for this version and conversation');
      }
      answers.push({ criterionKey: criterion.key, isNa: true, naConditionMet: true, naReason: result.na_reason });
    } else {
      if (result.na_reason !== null) invalid('AI_INVALID_NA', 'Applicable answers cannot include an N/A reason');
      if (criterion.type === 'scale') {
        if (typeof result.answer !== 'number' || !criterion.scaleSteps.some((step) => step.value === result.answer)) {
          invalid('AI_INVALID_ANSWER', 'AI scale answer is not an allowed step');
        }
      } else if (typeof result.answer !== 'boolean') invalid('AI_INVALID_ANSWER', 'AI boolean and flag answers must be boolean');
      answers.push({ criterionKey: criterion.key, value: result.answer });
    }
  }
  if (seen.size !== byKey.size) invalid('AI_CRITERIA_MISMATCH', 'AI response must include every checklist criterion');
  return { response, answers };
}
