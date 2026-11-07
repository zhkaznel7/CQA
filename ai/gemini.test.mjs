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
  return {criterion_id: key, na_assessment: {condition_met: false, reason: 'Условие N/A не выполнено.'},
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

test('p1-ru-025: N/A is derived from na_assessment, not the draft numeric answer', async () => {
  const input = conversation('p1-ru-025', ['04']);
  const result = row(input, '04', 10);
  result.na_assessment = {condition_met: true, reason: 'Клиент ушёл до формулировки запроса.'};
  result.answer = 0; // Ignored provider field, not part of the requested schema.
  const [wire] = await run(input, [result]);
  assert.equal(wire.answer, null);
  assert.equal(wire.na, true);
  assert.equal(wire.na_reason, result.na_assessment.reason);
  assert.equal(wire.explanation, result.na_assessment.reason);
});

test('N/A assessment is required, and allowNa alone does not grant N/A', async () => {
  const input = conversation('p1-ru-001', ['02']);
  const result = row(input, '02', 9);
  result.checks = [check('Учёл известные детали', true, 9)];
  assert.equal((await run(input, [result]))[0].na, false);
  result.checks = [];
  await assert.rejects(run(input, [result]), /нет проверок/);
  delete result.na_assessment;
  await assert.rejects(run(input, [result]), /na_assessment.condition_met/);
});

test('N/A with evidence for sufficient initial details produces a consistent wire result', async () => {
  const input = conversation('p1-kz-005', ['02']);
  const result = row(input, '02', 0);
  result.na_assessment = {condition_met: true, reason: 'Клиент уже указал нужное действие; дополнительных уточнений не требовалось.'};
  assert.equal((await run(input, [result]))[0].na, true);
  result.checks = [check('Дополнительное уточнение', true, 0)];
  await assert.rejects(run(input, [result]), /N\/A несовместим/);
});

test('ordinary chat greeting cannot acquire a prohibited N/A', async () => {
  const input = conversation('p1-ru-001', ['01']);
  const result = row(input, '01', 9);
  result.na_assessment.condition_met = true;
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
  result.na_assessment = {condition_met:true, reason:'Запрос не сформулирован.'};
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

test('provider schema is compact while per-criterion validation stays strict', async () => {
  const input = conversation('p1-ru-025', ['01','02','03','04','05','06','07','08']);
  let schema;
  await assert.rejects(evaluateGemini(input, {key:'test',model:'test',request:async (_url,init)=>{
    schema = JSON.parse(init.body).generationConfig.responseJsonSchema;
    return Response.json({error:{status:'INVALID_ARGUMENT',message:'Schema has too many states; secret-test-key'}},{status:400});
  }}), {code:'GEMINI_REQUEST_REJECTED',message:/HTTP 400, SCHEMA_COMPLEXITY/});
  const item = schema.properties.results.items;
  assert.ok(!item.anyOf);
  assert.deepEqual(item.properties.criterion_id.enum,input.checklist.criteria.map(c=>c.key));
  assert.ok(JSON.stringify(schema).length < 5000);
  const result = row(input,'06',9);
  result.levels = [{value:20,met:true,reason:'Wrong scale'}];
  assert.throws(()=>validateResults([result],{...input,checklist:{...input.checklist,criteria:[input.checklist.criteria.find(c=>c.key==='06')]}}),/ступени/);
});

test('400 diagnostics classify schema and key errors without leaking provider text', async () => {
  const input = conversation('p1-ru-025',['04']);
  for (const [error, reason] of [
    [{status:'INVALID_ARGUMENT',message:'responseJsonSchema is not supported: secret'}, 'INVALID_SCHEMA'],
    [{status:'INVALID_ARGUMENT',message:'unknown argument secret'}, 'INVALID_ARGUMENT'],
    [{details:[{reason:'API_KEY_INVALID'}],message:'secret'}, 'API_KEY_INVALID']
  ]) {
    const events=[];
    await assert.rejects(evaluateGemini(input,{key:'secret',model:'test',onEvent:e=>events.push(e),
      request:async ()=>Response.json({error},{status:400})}),
      e=>e.code==='GEMINI_REQUEST_REJECTED' && e.message.includes(reason) && !e.message.includes('secret'));
    assert.equal(events.find(e=>e.event==='provider_rejected').reason,reason);
    assert.ok(!JSON.stringify(events).includes('secret'));
  }
});

test('ordinary greeting and confirmed N/A stay distinct in one unchanged Backend response', async () => {
  const input = conversation('p1-ru-025', ['01','04']);
  const greeting = row(input, '01', 9);
  greeting.checks = [check('Приветствие на языке клиента', true, 9),
    check('Представление в первом ответе', true, 9, 2)];
  const consultation = row(input, '04', 10);
  consultation.na_assessment = {condition_met:true,reason:'Клиент покинул чат, не сформулировав вопрос.'};
  const output = await run(input, [greeting, consultation], {inspect: body => {
    const schema = body.generationConfig.responseJsonSchema.properties.results.items;
    assert.ok(!schema.properties.applicability);
    assert.deepEqual(schema.properties.na_assessment.required, ['condition_met','reason']);
    assert.equal(schema.properties.na_assessment.properties.condition_met.type, 'boolean');
    assert.match(body.systemInstruction.parts[0].text, /Если allowNa=false, condition_met ОБЯЗАТЕЛЬНО false/);
  }});
  assert.equal(output[0].answer,true);
  assert.equal(output[0].na,false);
  assert.equal(output[0].na_reason,null);
  assert.equal(output[1].answer,null);
  assert.equal(output[1].na,true);
  assert.equal(output[1].na_reason,consultation.na_assessment.reason);
  for (const result of output) {
    assert.deepEqual(Object.keys(result).sort(),
      ['criterion_id','answer','na','na_reason','explanation','evidence','checked_range'].sort());
  }
});

test('unmet N/A condition still allows zero for a formulated but unanswered request', async () => {
  const input = conversation('p1-ru-001', ['04']);
  const result = row(input,'04',0);
  result.na_assessment = {condition_met:false,reason:'Запрос сформулирован; основание N/A отсутствует.'};
  result.levels = levels(input,'04',0,'На сформулированный вопрос ответа нет.');
  const [wire] = await run(input,[result]);
  assert.equal(wire.answer,0);
  assert.equal(wire.na,false);
  assert.equal(wire.na_reason,null);
});

test('legacy ambiguous field or non-boolean N/A decision is rejected explicitly', async () => {
  const input = conversation('p1-ru-025',['04']);
  const result = row(input,'04',10);
  delete result.na_assessment;
  result.applicability = {met:true,reason:'Ambiguous old format'};
  await assert.rejects(run(input,[result]),/na_assessment.condition_met/);
  for (const condition_met of ['true',1,null,undefined]) {
    result.na_assessment = {condition_met,reason:'Не boolean'};
    await assert.rejects(run(input,[result]),/na_assessment.condition_met/);
  }
});

test('a violation flag cannot turn into N/A, even with an invalid allowNa config', async () => {
  const input = conversation('p1-en-014',['08']);
  input.checklist.criteria[0].allowNa = true;
  input.checklist.criteria[0].naCondition = 'Недостаточно данных';
  const result = row(input,'08',10);
  result.na_assessment = {condition_met:true,reason:'Недостаточно данных'};
  await assert.rejects(run(input,[result]),/N\/A не разрешён/);
});

test('T05: public tariffs give N/A for configurable identification key c3', async () => {
  const input = conversation('p1-ru-001',['03']);
  input.transcript = [
    {turnIndex:0,timestamp:'00:00',speaker:'client',text:'Где посмотреть публичные тарифы компании?'},
    {turnIndex:1,timestamp:'00:01',speaker:'operator',text:'Здравствуйте! Тарифы доступны на сайте.'}
  ];
  input.checklist.criteria[0] = {...input.checklist.criteria[0],key:'c3'};
  const result = row(input,'c3',0);
  result.na_assessment = {condition_met:true,reason:'Запрошена общедоступная информация; проверка личности не требуется.'};
  let calls=0;
  const [wire] = await run(input,[result],{inspect:()=>calls++});
  assert.equal(calls,1);
  assert.equal(wire.criterion_id,'c3');
  assert.equal(wire.na,true);
  assert.equal(wire.answer,null);
  assert.ok(wire.na_reason);
  assert.equal(wire.evidence[0].turnIndex,0);
});
