import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateScore, ScoringError, SCORING_VERSION } from '../src/modules/scoring/scoring.service.js';

const official = { ...JSON.parse(readFileSync(new URL('../prisma/seed/official-checklist.json', import.meta.url), 'utf8')), version: 1 };
const na = (criterion) => ({ criterionKey: criterion.key, isNa: true, naConditionMet: true, naReason: criterion.naCondition ?? 'Synthetic condition confirmed' });
function answersFor(checklist = official, overrides = {}) {
  return checklist.criteria.map((criterion) => {
    const value = Object.hasOwn(overrides, criterion.key) ? overrides[criterion.key]
      : criterion.type === 'flag' ? false : criterion.type === 'scale' ? Math.max(...criterion.scaleSteps.map((step) => step.value)) : true;
    return value === 'N/A' ? na(criterion) : { criterionKey: criterion.key, value };
  });
}
const score = (overrides = {}) => calculateScore(official, answersFor(official, overrides));
const hasCode = (code) => (error) => error instanceof ScoringError && error.code === code;
const approximately = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

function custom() {
  return {
    key: 'synthetic', name: 'Synthetic checklist', version: 7,
    sections: [{ key: 'a', name: 'First' }, { key: 'b', name: 'Second' }, { key: 'empty', name: 'Empty' }],
    criteria: [
      { key: 'yes', name: 'Boolean', description: 'Synthetic boolean', type: 'boolean', weight: 30, sectionKey: 'a', allowNa: true, naCondition: 'Synthetic boolean condition' },
      { key: 'level', name: 'Scale', description: 'Synthetic scale', type: 'scale', weight: 70, sectionKey: 'b', allowNa: true, naCondition: 'Synthetic scale condition',
        scaleSteps: [{ value: 0, label: 'Zero' }, { value: 0.125, label: 'Middle' }, { value: 0.5, label: 'Maximum' }] },
      { key: 'flag', name: 'Flag', description: 'Synthetic flag', type: 'flag', weight: 0, sectionKey: 'b' },
    ],
  };
}

test('control 1: all scored criteria fully satisfied -> 100', () => {
  const result = score();
  assert.equal(result.total, 100);
  assert.equal(result.maxPoints, 100);
  assert.equal(result.grossError, false);
  assert.equal(result.scoringVersion, SCORING_VERSION);
});

test('control 2: all scored criteria fail -> 0', () => {
  const result = score({ '01': false, '02': false, '03': false, '04': 0, '05': false, '06': 0, '07': false });
  assert.equal(result.total, 0);
  assert.equal(result.maxPoints, 100);
});

test('control 3: c3=N/A, c1/c2/c5/c7=true, c4=15, c6=7 -> 88.13', () => {
  const result = score({ '03': 'N/A', '04': 15, '06': 7 });
  assert.equal(result.total, 88.13); // 70.5 / 80 * 100 = 88.125, round only at the end.
  assert.equal(result.applicableWeight, 80);
  const c3 = result.criteria.find((criterion) => criterion.key === '03');
  assert.equal(c3.points, 0);
  assert.equal(c3.maxPoints, 0);
  assert.equal(c3.isNa, true);
  const c6 = result.criteria.find((criterion) => criterion.key === '06');
  assert.equal(c6.basePoints, 10.5); // Scale max 10, weight 15.
  assert.equal(c6.points, 13.125);
  assert.equal(c6.maxPoints, 18.75);
});

test('control 4: c2/c3/c4/c7=N/A, c1/c5=true, c6=10 -> 100', () => {
  const result = score({ '02': 'N/A', '03': 'N/A', '04': 'N/A', '07': 'N/A' });
  assert.equal(result.total, 100);
  assert.equal(result.applicableWeight, 40);
  assert.deepEqual(result.criteria.filter((criterion) => !criterion.isNa && criterion.type !== 'flag').map((criterion) => criterion.maxPoints), [25, 37.5, 37.5]);
});

test('control 5: c8=true sets grossError without changing total or denominator', () => {
  const regular = score({ '03': 'N/A', '04': 15, '06': 7 });
  const flagged = score({ '03': 'N/A', '04': 15, '06': 7, '08': true });
  assert.equal(flagged.grossError, true);
  assert.equal(flagged.total, regular.total);
  assert.equal(flagged.applicableWeight, regular.applicableWeight);
  const flag = flagged.criteria.find((criterion) => criterion.key === '08');
  assert.equal(flag.value, true);
  assert.equal(flag.points, 0);
  assert.equal(flag.maxPoints, 0);
});

test('control 6: c1/c5/c6 do not allow N/A', () => {
  for (const key of ['01', '05', '06']) assert.throws(() => score({ [key]: 'N/A' }), hasCode('NA_NOT_ALLOWED'));
});

test('control 7: only declared scale steps are valid', () => {
  for (const [key, value] of [['04', 17], ['04', 21], ['06', 8], ['06', 0.5]]) {
    assert.throws(() => score({ [key]: value }), hasCode('INVALID_SCALE_VALUE'));
  }
});

test('control 8: repeated scoring is deterministic and independent of answer order', () => {
  const answers = answersFor(official, { '03': 'N/A', '04': 15, '06': 7 });
  const first = calculateScore(official, answers);
  assert.deepEqual(calculateScore(official, answers), first);
  assert.deepEqual(calculateScore(official, [...answers].reverse()), first);
  assert.equal(JSON.stringify(calculateScore(official, answers)), JSON.stringify(first));
});

test('partial answers, including missing flags, cannot produce a final total', () => {
  assert.throws(() => calculateScore(official, []), hasCode('INCOMPLETE_ANSWERS'));
  assert.throws(() => calculateScore(official, answersFor().slice(0, -1)), hasCode('INCOMPLETE_ANSWERS'));
  assert.throws(() => calculateScore(official, answersFor().slice(1)), hasCode('INCOMPLETE_ANSWERS'));
});

test('N/A requires explicit condition confirmation and a nonempty explanation', () => {
  for (const replacement of [
    { isNa: true },
    { isNa: true, naConditionMet: false, naReason: 'Synthetic explanation' },
    { isNa: true, naConditionMet: true, naReason: ' ' },
    { isNa: true, naConditionMet: true, naReason: 'Confirmed', value: 0 },
  ]) {
    const answers = answersFor();
    answers[2] = { criterionKey: '03', ...replacement };
    assert.throws(() => calculateScore(official, answers), hasCode('INVALID_ANSWERS'));
  }
});

test('N/A is not inferred from null, an absent answer or the string N/A', () => {
  for (const value of [null, 'N/A', undefined]) {
    const answers = answersFor(); answers[2] = { criterionKey: '03', value };
    assert.throws(() => calculateScore(official, answers), hasCode('INVALID_ANSWERS'));
  }
});

test('flags cannot be N/A or numerical answers', () => {
  assert.throws(() => score({ '08': 'N/A' }), hasCode('NA_NOT_ALLOWED'));
  assert.throws(() => score({ '08': 1 }), hasCode('INVALID_BOOLEAN_VALUE'));
  assert.throws(() => score({ '01': 1 }), hasCode('INVALID_BOOLEAN_VALUE'));
  assert.throws(() => score({ '04': true }), hasCode('INVALID_SCALE_VALUE'));
});

test('unknown criteria and duplicate answers are rejected', () => {
  assert.throws(() => calculateScore(official, [...answersFor(), { criterionKey: 'unknown', value: true }]), hasCode('UNKNOWN_CRITERION'));
  assert.throws(() => calculateScore(official, [...answersFor(), answersFor()[0]]), hasCode('DUPLICATE_ANSWER'));
});

test('negative, nonfinite and ambiguous answer inputs are rejected', () => {
  for (const value of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(() => score({ '04': value }), hasCode('INVALID_ANSWERS'));
  }
  const answers = answersFor(); answers[0].points = 100;
  assert.throws(() => calculateScore(official, answers), hasCode('INVALID_ANSWERS'));
  assert.throws(() => calculateScore(official, {}), hasCode('INVALID_ANSWERS'));
});

test('custom checklist supports arbitrary keys, fractional ascending scales and sections', () => {
  const checklist = custom();
  const result = calculateScore(checklist, answersFor(checklist, { yes: false, level: 0.125 }));
  assert.equal(result.total, 17.5);
  assert.equal(result.checklistVersion, 7);
  assert.deepEqual(result.sections, [
    { key: 'a', name: 'First', points: 0, maxPoints: 30 },
    { key: 'b', name: 'Second', points: 17.5, maxPoints: 70 },
    { key: 'empty', name: 'Empty', points: 0, maxPoints: 0 },
  ]);
  assert.equal(result.criteria[1].basePoints, 17.5);
});

test('all scored custom criteria N/A -> total=null, with flag still independent', () => {
  const checklist = custom();
  const result = calculateScore(checklist, answersFor(checklist, { yes: 'N/A', level: 'N/A', flag: true }));
  assert.equal(result.total, null);
  assert.equal(result.maxPoints, 0);
  assert.equal(result.applicableWeight, 0);
  assert.equal(result.grossError, true);
  assert.ok(result.criteria.every((criterion) => criterion.points === 0 && criterion.maxPoints === 0));
  assert.ok(result.sections.every((section) => section.points === 0 && section.maxPoints === 0));
});

test('zero weights are allowed only for flags, matching existing checklist validation', () => {
  const checklist = custom();
  assert.equal(calculateScore(checklist, answersFor(checklist)).total, 100);
  checklist.criteria[0].weight = 0;
  checklist.criteria[1].weight = 100;
  assert.throws(() => calculateScore(checklist, answersFor(checklist)), hasCode('INVALID_CHECKLIST'));
  const flagged = custom(); flagged.criteria[2].weight = 1;
  assert.throws(() => calculateScore(flagged, answersFor(flagged)), hasCode('INVALID_CHECKLIST'));
});

test('criteria with N/A do not redistribute weight within sections only', () => {
  const result = score({ '03': 'N/A', '04': 15, '06': 7 });
  approximately(result.sections.reduce((sum, section) => sum + section.maxPoints, 0), 100);
  assert.equal(result.sections.find((section) => section.key === 'start').maxPoints, 31.25);
  assert.equal(result.sections.find((section) => section.key === 'safety').maxPoints, 25);
  assert.equal(result.sections.find((section) => section.key === 'dialogue').maxPoints, 43.75);
  assert.equal(result.sections.find((section) => section.key === 'violations').maxPoints, 0);
  approximately(result.sections.reduce((sum, section) => sum + section.points, 0), 88.125);
});

test('round only the total: do not sum rounded criterion contributions', () => {
  const checklist = custom();
  checklist.criteria = ['first', 'second', 'third'].map((key, index) => ({
    key, name: key, description: 'Synthetic fraction', type: 'scale', weight: index === 2 ? 60 : 20,
    sectionKey: 'a', scaleSteps: [{ value: 0, label: 'Zero' }, { value: 1, label: 'One' }, { value: 6, label: 'Six' }],
  }));
  const result = calculateScore(checklist, answersFor(checklist, { first: 1, second: 1, third: 1 }));
  assert.equal(result.total, 16.67);
  approximately(result.criteria[0].points, 20 / 6);
  assert.equal(result.criteria[2].points, 10);
  assert.equal(result.criteria.reduce((sum, criterion) => sum + Math.round(criterion.points * 100) / 100, 0), 16.66);
});

test('custom decimal weights are handled exactly without early rounding', () => {
  const checklist = custom(); checklist.criteria[0].weight = 33.33; checklist.criteria[1].weight = 66.67;
  const result = calculateScore(checklist, answersFor(checklist, { yes: false, level: 0.125 }));
  assert.equal(result.total, 16.67); // Exactly 16.6675.
});

test('Prisma row and API detail shapes produce the same scoring result', () => {
  const checklist = custom();
  const id = '00000000-0000-4000-8000-000000000001';
  const plain = { ...checklist, id };
  const row = { id, key: checklist.key, name: checklist.name, version: checklist.version,
    config: { schemaVersion: 1, sections: checklist.sections },
    criteria: checklist.criteria.map(({ key, name, ...config }, position) => ({ key, name,
      maxPoints: { toString: () => config.type === 'flag' ? '0' : config.type === 'boolean' ? '1' : '0.5' },
      config: { ...config, position, schemaVersion: 1 } })).reverse(),
  };
  assert.deepEqual(calculateScore(row, answersFor(checklist)), calculateScore(plain, answersFor(checklist)));
  row.criteria[0].maxPoints = 999;
  assert.throws(() => calculateScore(row, answersFor(checklist)), hasCode('INVALID_CHECKLIST'));
});

test('missing version, legacy untyped criteria and malformed checklist configs fail safely', () => {
  const checklist = structuredClone(official); delete checklist.version;
  assert.throws(() => calculateScore(checklist, answersFor()), hasCode('INVALID_CHECKLIST'));
  for (const invalid of [null, {}, { ...official, version: 0 }, { ...official, criteria: null }, { ...official, criteria: [null] }]) {
    assert.throws(() => calculateScore(invalid, answersFor()), hasCode('INVALID_CHECKLIST'));
  }
  const legacy = { ...official, criteria: official.criteria.map(({ key, name }) => ({ key, name, config: {} })) };
  assert.throws(() => calculateScore(legacy, answersFor()), hasCode('INVALID_CHECKLIST'));
});

test('rejects invalid weights, duplicate keys, bad sections, scale definitions and N/A config', () => {
  for (const mutate of [
    (value) => value.criteria[0].weight = -1,
    (value) => value.criteria[0].weight = 29,
    (value) => value.criteria[0].weight = 30.001,
    (value) => value.criteria[1].key = 'yes',
    (value) => value.criteria[1].sectionKey = 'unknown',
    (value) => value.criteria[1].scaleSteps = [{ value: 0, label: 'Only zero' }],
    (value) => value.criteria[1].scaleSteps[1].value = 0.5,
    (value) => value.criteria[1].type = 'unknown',
    (value) => value.criteria[0].naCondition = null,
  ]) {
    const checklist = custom(); mutate(checklist);
    assert.throws(() => calculateScore(checklist, []), hasCode('INVALID_CHECKLIST'));
  }
});

test('repeated fractions with large aggregate denominators never produce NaN or Infinity', () => {
  const checklist = custom();
  checklist.criteria = Array.from({ length: 100 }, (_, index) => ({
    key: `fraction-${index}`, name: 'Synthetic', description: 'Distinct denominator', type: 'scale', weight: 1, sectionKey: 'a',
    scaleSteps: [{ value: 0, label: 'Zero' }, { value: 0.0001, label: 'Small' }, { value: (10000000000 - index) / 10000, label: 'Maximum' }],
  }));
  const result = calculateScore(checklist, checklist.criteria.map((criterion) => ({ criterionKey: criterion.key, value: 0.0001 })));
  assert.equal(result.total, 0);
  assert.ok(result.sections[0].points > 0);
  assert.ok(Number.isFinite(result.sections[0].points));
  assert.equal(result.sections[0].maxPoints, 100);
});

test('scoring does not mutate caller objects, including frozen snapshots', () => {
  const checklist = structuredClone(official);
  const answers = answersFor(checklist, { '03': 'N/A' });
  const before = JSON.stringify({ checklist, answers });
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  freeze(checklist); freeze(answers);
  calculateScore(checklist, answers);
  assert.equal(JSON.stringify({ checklist, answers }), before);
});
