import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateGemini, validateResults} from './gemini.mjs';

const records = JSON.parse(readFileSync(new URL('../data/dev.json', import.meta.url))).data.records;
const checklist = JSON.parse(readFileSync(new URL('./mock-request.json', import.meta.url))).checklist;
function conversation(id, keys) {
  const record = records.find(r => r.conversation_id === id);
  return {...record, transcript: record.transcript.map((t, turnIndex) => ({...t, turnIndex})),
    checklist: {...checklist, criteria: checklist.criteria.filter(c => keys.includes(c.key))}};
}
function row(input, key, index) {
  return {criterion_id: key, applicability: {met: false, reason: 'Условие N/A не выполнено.'},
    checks: [], levels: [], explanation: 'Предварительное объяснение модели.',
    evidence: [{turnIndex: index, quote: input.transcript[index].text}],
    omission: false, checked_range: {start: 0, end: input.transcript.length - 1}, limitations: []};
}
function check(condition, met, index, group = 1) {
  return {condition, met, group, reason: condition + (met ? ' есть в реплике.' : ' отсутствует в проверенном эпизоде.'), turnIndexes: [index]};
}
function levels(input, key, selected, reason) {
  return input.checklist.criteria.find(c => c.key === key).scaleSteps.map(step =>
    ({value: step.value, met: step.value === selected, reason: step.value === selected ? reason : 'Эта ступень не соответствует эпизоду.'}));
}
function run(input, rows, {review = {requests: [], issues: []}, status = 200, inspect = () => {}} = {}) {
  return evaluateGemini(input, {key: 'test-secret', model: 'test', request: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).criteria, input.checklist.criteria);
    inspect(body);
    return Response.json({candidates: [{finishReason: 'STOP', content: {parts: [{text: JSON.stringify({review, results: rows})}]}}]}, {status});
  }});
}

test('p1-ru-025: N/A is derived from applicability, not the draft numeric answer', async () => {
  const input = conversation('p1-ru-025', ['04']);
  const result = row(input, '04', 10);
  result.applicability = {met: true, reason: 'Клиент ушёл до формулировки запроса.'};
  result.answer = 0; // Ignored provider field, not part of the requested schema.
  const [wire] = await run(input, [result]);
  assert.equal(wire.answer, null);
  assert.equal(wire.na, true);
  assert.equal(wire.na_reason, result.applicability.reason);
  assert.equal(wire.explanation, result.applicability.reason);
});

test('N/A assessment is required, and allowNa alone does not grant N/A', async () => {
  const input = conversation('p1-ru-001', ['02']);
  const result = row(input, '02', 9);
  result.checks = [check('Учёл известные детали', true, 9)];
  assert.equal((await run(input, [result]))[0].na, false);
  result.checks = [];
  await assert.rejects(run(input, [result]), /нет проверок/);
  delete result.applicability;
  await assert.rejects(run(input, [result]), /нет отдельной проверки/);
});

test('N/A with evidence for sufficient initial details produces a consistent wire result', async () => {
  const input = conversation('p1-kz-005', ['02']);
  const result = row(input, '02', 0);
  result.applicability = {met: true, reason: 'Клиент уже указал нужное действие; дополнительных уточнений не требовалось.'};
  assert.equal((await run(input, [result]))[0].na, true);
  result.checks = [check('Дополнительное уточнение', true, 0)];
  await assert.rejects(run(input, [result]), /N\/A несовместим/);
});

test('ordinary chat greeting cannot acquire a prohibited N/A', async () => {
  const input = conversation('p1-ru-001', ['01']);
  const result = row(input, '01', 9);
  result.applicability.met = true;
  await assert.rejects(run(input, [result]), /N\/A не разрешён/);
});

test('compound conditions compute AND and OR; unsupported evidence is rejected', () => {
  const input = conversation('p1-kz-008', ['01']);
  const result = row(input, '01', 9);
  result.answer = true;
  result.checks = [check('Приветствие', true, 9), check('Представление', false, 9, 2)];
  let wire = validateResults([result], input)[0];
  assert.equal(wire.answer, false);
  assert.match(wire.explanation, /Представление — не подтверждено/);
  result.checks[1].group = 1;
  assert.equal(validateResults([result], input)[0].answer, true);
  result.checks[0].turnIndexes = [8];
  assert.throws(() => validateResults([result], input), /доказательств/);
});

test('p1-en-014: reaction to concern is separately required for empathy', async () => {
  const input = conversation('p1-en-014', ['05']);
  const result = row(input, '05', 12);
  result.checks = [check('Вежливость', true, 12), check('Реакция на опасение о проверке личности', false, 12, 2)];
  const [wire] = await run(input, [result]);
  assert.equal(wire.answer, false);
  assert.match(wire.explanation, /Реакция на опасение о проверке личности — не подтверждено/);
});

test('p1-en-015: all levels are checked and selected level explains the communication failure', async () => {
  const input = conversation('p1-en-015', ['06']);
  const result = row(input, '06', 10);
  result.levels = levels(input, '06', 4, 'Клиент переспросил Settings where? после неясной инструкции.');
  result.answer = 10;
  const review = {requests: [{turnIndex: 10, answerTurnIndexes: [11], status: 'answered', summary: 'Уточнение непонятной инструкции'}],
    issues: [{turnIndexes: [9, 10], description: 'Клиент вынужден переспрашивать'}]};
  const [wire] = await run(input, [result], {review});
  assert.equal(wire.answer, 4);
  assert.match(wire.explanation, /переспросил/);
  result.levels.pop();
  await assert.rejects(run(input, [result]), /каждой ступени/);
});

test('flag computes OR across each checked violation, with no extra third-party condition', async () => {
  const input = conversation('p1-en-014', ['08']);
  const result = row(input, '08', 10);
  result.checks = [check('Оскорбление', false, 10), check('Платная услуга в обход компании', false, 10),
    check('Раскрытие конфиденциальной информации', true, 10)];
  const [wire] = await run(input, [result], {inspect: body => {
    assert.match(body.systemInstruction.parts[0].text, /Не добавляй «третьим лицам»/);
  }});
  assert.equal(wire.answer, true);
  assert.equal(wire.na, false);
  result.checks[2].met = false;
  result.checked_range = {start: 10, end: 10};
  await assert.rejects(run(input, [result]), /всего диалога/);
});

test('custom scale and key are driven by current config; no negative fact invented for missing knowledge', async () => {
  const input = conversation('p1-ru-001', ['04']);
  input.checklist.criteria[0] = {...input.checklist.criteria[0], key: 'custom', allowNa: false,
    scaleSteps: [{value: 0, label: 'Не решено'}, {value: 3, label: 'Решено'}]};
  const result = row(input, 'custom', 9);
  result.levels = levels(input, 'custom', 3, 'Клиент подтвердил успешный результат.');
  result.limitations = ['Актуальность внешнего пути меню не проверена по базе знаний.'];
  const [wire] = await run(input, [result]);
  assert.equal(wire.answer, 3);
  assert.match(wire.explanation, /Ограничения/);
  assert.deepEqual(Object.keys(wire).sort(), ['criterion_id','answer','na','na_reason','explanation','evidence','checked_range'].sort());
});

test('quotes, ranges, duplicate keys, levels and review links are validated', async () => {
  const input = conversation('p1-ru-001', ['04']);
  const base = row(input, '04', 9);
  base.levels = levels(input, '04', 20, 'Запрос закрыт.');
  for (const patch of [
    {evidence: [{turnIndex: 9, quote: 'invented quote'}]},
    {checked_range: {start: 0, end: 0}},
    {omission: true, checked_range: null},
    {levels: base.levels.map(l => ({...l, met: false}))}
  ]) await assert.rejects(run(input, [{...base, ...patch}]), {status: 502});
  await assert.rejects(run(input, [base], {review: {requests: [{turnIndex: 9, answerTurnIndexes: [], status: 'unanswered', summary: 'wrong role'}], issues: []}}), /обзоре/);
  assert.throws(() => validateResults([base, base], {...input, checklist: {...input.checklist, criteria: [input.checklist.criteria[0], {...input.checklist.criteria[0], key: 'other'}]}}), /ключ/);
});

test('provider quota, timeout and authorization errors remain safe', async () => {
  const input = conversation('p1-ru-001', ['04']);
  await assert.rejects(run(input, [], {status: 429}), {status: 503, message: /Google HTTP 429/});
  await assert.rejects(run(input, [], {status: 503}), {status: 503, message: /Google HTTP 503/});
  await assert.rejects(run(input, [], {status: 504}), {status: 504});
  const request = async () => Response.json({error: {message: 'sensitive', details: [{reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED'}]}}, {status: 401});
  await assert.rejects(evaluateGemini(input, {key: 'test', model: 'test', request}),
    error => error.status === 502 && error.message.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') && !error.message.includes('sensitive'));
});

test('diagnostics distinguish dispatch, headers, body and validation without logging content', async () => {
  const input = conversation('p1-ru-025', ['04']);
  const result = row(input, '04', 10);
  result.applicability = {met:true, reason:'Запрос не сформулирован.'};
  const events = [];
  let calls = 0;
  await evaluateGemini(input, {key:'secret-test-key', model:'test', onEvent:e=>events.push(e),
    request:async () => {
      calls++;
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({
        review:{requests:[],issues:[]},results:[result]
      })}]}}]});
    }});
  assert.equal(calls,1);
  assert.deepEqual(events.map(e=>e.event),['evaluation_started','provider_dispatched','provider_headers','provider_body','evaluation_completed']);
  assert.equal(events.find(e=>e.event==='provider_headers').http_status,200);
  assert.ok(events.every(e=>Number.isFinite(e.elapsed_ms)));
  assert.ok(!JSON.stringify(events).includes('secret-test-key'));
  assert.ok(!JSON.stringify(events).includes(input.transcript[9].text));
});

test('timeout location distinguishes no headers from a stalled body; neither is retried', async () => {
  const input = conversation('p1-ru-025', ['04']);
  for (const phase of ['awaiting_headers','reading_body']) {
    const events = [];
    let calls = 0;
    const timeout = () => {throw new DOMException('do not log secret payload','TimeoutError');};
    await assert.rejects(evaluateGemini(input,{key:'test',model:'test',onEvent:e=>events.push(e),
      request:async () => {
        calls++;
        if (phase==='awaiting_headers') timeout();
        return {status:200,text:async ()=>timeout()};
      }}),{code:'AI_TIMEOUT',status:504});
    assert.equal(calls,1);
    assert.equal(events.find(e=>e.event==='provider_timeout').phase,phase);
    assert.equal(events.at(-1).error_code,'AI_TIMEOUT');
    assert.ok(!JSON.stringify(events).includes('secret payload'));
  }
});
