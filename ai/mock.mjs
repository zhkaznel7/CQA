import {readFileSync} from 'node:fs';

const fixtures = JSON.parse(readFileSync(new URL('./mock-na-fixtures.json', import.meta.url), 'utf8'));

const normalized = text => typeof text === 'string' ? text.trim().replace(/\s+/g, ' ').replace(/[.!]$/, '') : '';

function matchesCriterion(rule, criterion) {
  if (rule.type !== criterion.type) return false;
  if (rule.criterionKey) {
    // Stable-key rules cover explicit, reviewed equivalents of the condition.
    // An unrelated edited condition must not inherit the old N/A decision.
    return rule.criterionKey === criterion.key &&
      [rule.naCondition, ...(rule.naConditionAliases ?? [])]
        .some(condition => normalized(condition) === normalized(criterion.naCondition));
  }
  return rule.description === criterion.description && rule.naCondition === criterion.naCondition;
}

export function evaluateMock({channel, transcript, checklist}) {
  const scenario = fixtures.find(f => f.channel === channel &&
    (f.requiredEvidence
      ? f.requiredEvidence.every(proof => transcript.some(t => t.speaker === proof.speaker && t.text === proof.text))
      : f.transcript.length === transcript.length &&
        f.transcript.every((t, i) => t.speaker === transcript[i].speaker && t.text === transcript[i].text)));
  const turn = transcript.find(t => t.speaker === 'operator') ?? transcript[0];
  return checklist.criteria.map(c => {
    const match = c.allowNa && c.type !== 'flag' && scenario?.criteria.find(rule =>
      matchesCriterion(rule, c));
    const na = Boolean(match);
    const evidenceTurn = na
      ? scenario.requiredEvidence
        ? transcript.find(t => t.speaker === scenario.requiredEvidence[0].speaker && t.text === scenario.requiredEvidence[0].text)
        : transcript[match.evidenceTurnIndex]
      : turn;
    return {
      criterion_id: c.key,
      answer: na ? null : c.type === 'scale' ? c.scaleSteps[0].value : false,
      na,
      na_reason: na ? match.reason : null,
      explanation: na
        ? 'Mock: применимость N/A подтверждена размеченным сценарием ' + scenario.name + '.'
        : 'Mock: обычная синтетическая оценка; условие N/A не подтверждено размеченным сценарием.',
      evidence: [{turnIndex: evidenceTurn.turnIndex, quote: evidenceTurn.text}],
      checked_range: !na && c.type === 'boolean' ? {start: 0, end: transcript.length - 1} : null
    };
  });
}
