import { parseChecklist, parseAnswers } from './scoring.schema.js';
import { fraction, add, multiply, asNumber, roundTwo } from './fraction.js';

export { ScoringError } from './scoring-error.js';
export const SCORING_VERSION = '1.0.0';

/**
 * Pure, synchronous scoring of one complete checklist version.
 * Does not import env/Prisma, call AI, access the network or persist anything.
 * Answers are keyed by the checklist's exact criterion key (official keys: 01..08).
 */
export function calculateScore(checklistVersion, answers) {
  const checklist = parseChecklist(checklistVersion);
  const byKey = parseAnswers(answers, checklist);
  const activeWeightUnits = checklist.criteria.reduce((sum, criterion) =>
    sum + (criterion.type !== 'flag' && !byKey.get(criterion.key).isNa ? Math.round(criterion.weight * 100) : 0), 0);
  const zero = fraction(0n);
  let earned = zero;
  let grossError = false;
  const sectionTotals = new Map(checklist.sections.map((section) => [section.key, { points: zero, maximum: zero }]));

  const criteria = checklist.criteria.map((criterion) => {
    const answer = byKey.get(criterion.key);
    let maximum = zero;
    let points = zero;
    let basePoints = zero;
    if (criterion.type === 'flag') {
      grossError ||= answer.value;
    } else if (!answer.isNa) {
      const weightUnits = BigInt(Math.round(criterion.weight * 100));
      // Four decimals match the existing scale configuration limits.
      const ratio = criterion.type === 'boolean'
        ? fraction(answer.value ? 1n : 0n)
        : fraction(BigInt(Math.round(answer.value * 10000)), BigInt(Math.round(Math.max(...criterion.scaleSteps.map((step) => step.value)) * 10000)));
      maximum = fraction(weightUnits * 100n, BigInt(activeWeightUnits));
      basePoints = multiply(ratio, fraction(weightUnits, 100n));
      points = multiply(ratio, maximum);
    }
    earned = add(earned, points);
    const section = sectionTotals.get(criterion.sectionKey);
    section.points = add(section.points, points);
    section.maximum = add(section.maximum, maximum);
    return {
      key: criterion.key, sectionKey: criterion.sectionKey, type: criterion.type,
      value: answer.isNa ? null : answer.value, isNa: answer.isNa,
      naReason: answer.naReason ?? null,
      weight: criterion.weight,
      basePoints: asNumber(basePoints), points: asNumber(points), maxPoints: asNumber(maximum),
    };
  });

  const sections = checklist.sections.map((section) => {
    const values = sectionTotals.get(section.key);
    return { key: section.key, name: section.name,
      points: asNumber(values.points), maxPoints: asNumber(values.maximum) };
  });
  return {
    scoringVersion: SCORING_VERSION,
    checklistId: checklist.id ?? null, checklistKey: checklist.key, checklistVersion: checklist.version,
    applicableWeight: activeWeightUnits / 100,
    maxPoints: activeWeightUnits > 0 ? 100 : 0,
    total: activeWeightUnits > 0 ? roundTwo(earned) : null,
    grossError, criteria, sections,
  };
}
