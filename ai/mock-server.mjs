import {startServer, fail} from './http.mjs';
const failures = {
  502: ['INVALID_MODEL_OUTPUT', 'Модель вернула некорректный результат.'],
  503: ['AI_UNAVAILABLE', 'Модель временно недоступна.'],
  504: ['AI_TIMEOUT', 'Истёк срок обработки запроса.']
};
const simulated = process.env.MOCK_ERROR_STATUS;
if (simulated && !Object.hasOwn(failures, simulated)) throw Error('MOCK_ERROR_STATUS: 502, 503 или 504');

startServer('CQA mock', ({transcript, checklist}) => {
  if (simulated) fail(Number(simulated), ...failures[simulated]);
  const turn = transcript.find(t => t.speaker === 'operator') ?? transcript[0];
  return checklist.criteria.map(c => {
    // Deterministic fixtures exercise wire types, not the meaning of the transcript.
    const na = c.allowNa;
    const answer = na ? null : c.type === 'scale' ? c.scaleSteps[0].value : false;
    return {
      criterion_id: c.key, answer, na, na_reason: na ? c.naCondition : null,
      explanation: 'Mock: синтетический результат для проверки интеграции.',
      evidence: [{ turnIndex: turn.turnIndex, quote: turn.text }],
      checked_range: !na && c.type === 'boolean' ? { start: 0, end: transcript.length - 1 } : null
    };
  });
});
