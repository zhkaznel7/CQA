import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateMock} from './mock.mjs';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const request = () => read('./mock-request.json');
const fixtures = read('./mock-na-fixtures.json');

test('known public request confirms only need discovery and identification N/A', () => {
  const input = request();
  const rows = evaluateMock(input);
  assert.deepEqual(rows.filter(r => r.na).map(r => r.criterion_id), ['02','03']);
  for (const r of rows) {
    assert.equal(r.na_reason === null, !r.na);
    if (r.na) assert.equal(r.answer, null);
    for (const e of r.evidence) assert.ok(input.transcript[e.turnIndex].text.includes(e.quote));
  }
});

function recording(channel) {
  const input = request();
  input.channel = channel;
  input.transcript = fixtures[1].transcript.map((t, turnIndex) =>
    ({...t, turnIndex, timestamp: '2026-11-07T12:00:00Z'}));
  input.checklist.criteria = [{
    key:'custom-greeting',allowNa:true, ...fixtures[1].criteria[0]
  }];
  return input;
}

test('missing recording permits greeting N/A only for a confirmed voice scenario', () => {
  const [voice] = evaluateMock(recording('voice call'));
  assert.equal(voice.na, true);
  assert.equal(voice.evidence[0].turnIndex, 0);
  const [chat] = evaluateMock(recording('agent chat'));
  assert.equal(chat.na, false);
  assert.equal(chat.answer, false);
  assert.equal(chat.na_reason, null);
});

test('no confirmation, changed definition or disabled N/A gives ordinary answers', () => {
  const input = request();
  input.transcript[0].text = 'Покажите баланс моего счёта и переведите деньги.';
  assert.ok(evaluateMock(input).every(r => !r.na));
  for (const field of ['description','naCondition']) {
    const input = request();
    input.checklist.criteria[2][field] = 'Новое условие';
    assert.equal(evaluateMock(input)[2].na, false);
  }
  const disabled = request();
  disabled.checklist.criteria.forEach(c => c.allowNa = false);
  assert.ok(evaluateMock(disabled).every(r => !r.na));
  const unconfirmed = recording('voice call');
  unconfirmed.transcript.shift();
  unconfirmed.transcript.forEach((t, i) => t.turnIndex = i);
  assert.equal(evaluateMock(unconfirmed)[0].na, false);
});

test('dynamic keys, versions, scales, flag and unlabelled languages remain supported', () => {
  for (const language of ['RU','KZ','EN']) {
    const input = request();
    input.language = language;
    input.transcript[0].text = {RU:'Другой запрос', KZ:'Менің шотым', EN:'My account'}[language];
    input.checklist.version = 2;
    input.checklist.criteria[3].key = 'new-scale';
    input.checklist.criteria[3].scaleSteps = [{value:4,label:'OK'},{value:0,label:'Нет'}];
    const rows = evaluateMock(input);
    assert.ok(rows.every(r => !r.na));
    assert.equal(rows[3].criterion_id, 'new-scale');
    assert.equal(rows[3].answer, 4);
    assert.equal(rows[7].answer, false);
  }
  const renamed = request();
  renamed.checklist.criteria[2].key = 'identity-renamed';
  assert.equal(evaluateMock(renamed)[2].na, true);
});
