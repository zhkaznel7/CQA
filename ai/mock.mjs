import {readFileSync} from 'node:fs';

const fixtures = JSON.parse(readFileSync(new URL('./mock-na-fixtures.json', import.meta.url), 'utf8'));

export function evaluateMock({channel, transcript, checklist}) {
  // Match the entire labelled scenario. Keys, versions and timestamps do not
  // determine applicability; changed definitions must be labelled again.
  const scenario = fixtures.find(f => f.channel === channel &&
    f.transcript.length === transcript.length &&
    f.transcript.every((t, i) => t.speaker === transcript[i].speaker && t.text === transcript[i].text));
  const turn = transcript.find(t => t.speaker === 'operator') ?? transcript[0];
  return checklist.criteria.map(c => {
    const match = c.allowNa && c.type !== 'flag' && scenario?.criteria.find(rule =>
      rule.type === c.type && rule.description === c.description && rule.naCondition === c.naCondition);
    const na = Boolean(match);
    const evidenceTurn = na ? transcript[match.evidenceTurnIndex] : turn;
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
