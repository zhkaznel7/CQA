import { ApiError } from '../middleware/api-error.js';

export function createMockAiClient({ scenario = 'success', overrides = {} } = {}) {
  return {
    source: 'mock', transport: 'local',
    async evaluate(request) {
      if (scenario === 'timeout') throw new ApiError(504, 'AI_TIMEOUT', 'Mock AI timeout');
      if (scenario === 'unavailable') throw new ApiError(503, 'AI_UNAVAILABLE', 'Mock AI unavailable');
      if (scenario === 'invalid-json') throw new ApiError(502, 'AI_INVALID_JSON', 'Mock AI invalid JSON');
      const results = request.checklist.criteria.map((criterion) => ({
        criterion_id: criterion.key,
        answer: criterion.type === 'scale' ? Math.min(...criterion.scaleSteps.map((step) => step.value)) : false,
        na: false, na_reason: null,
        explanation: 'MOCK: synthetic placeholder, not a real quality assessment.',
        evidence: [], checked_range: { start: 0, end: request.transcript.length - 1 },
        ...structuredClone(overrides[criterion.key] ?? {}),
      }));
      if (scenario === 'bad-scale') {
        const result = results.find((item) => request.checklist.criteria.find((criterion) => criterion.key === item.criterion_id).type === 'scale');
        if (result) result.answer = -1;
      }
      if (scenario === 'false-quote') results[0].evidence = [{ turnIndex: 0, quote: '__FALSE_MOCK_QUOTE__' }];
      if (scenario === 'missing') results.pop();
      if (scenario === 'duplicate') results.push(structuredClone(results[0]));
      if (scenario === 'na') {
        const criterion = request.checklist.criteria.find((item) => item.allowNa);
        if (criterion) Object.assign(results.find((item) => item.criterion_id === criterion.key), { na: true, answer: null, na_reason: 'MOCK: condition needs independent confirmation.' });
      }
      return { conversation_id: request.conversation_id, checklist_id: request.checklist.id, checklist_version: request.checklist.version, results };
    },
  };
}
