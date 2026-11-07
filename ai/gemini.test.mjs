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
  return {criterion_id: key, na_assessment: {condition_met: false, initial_information_sufficient: null, reason: 'Условие N/A не выполнено.'},
    checks: [], violations: [], levels: [], explanation: 'Предварительное объяснение модели.',
    evidence: [{turnIndex: index, quote: input.transcript[index].text}],
    omission: false, checked_range: {start: 0, end: input.transcript.length - 1}, limitations: []};
}
function check(condition, met, index, group = 1) {
  return {condition, met, group, reason: condition + (met ? ' есть в реплике.' : ' отсутствует в проверенном эпизоде.'), turnIndexes: [index]};
}
function discoveryChecks(index, known = true, clarified = true) {
  return [
    {...check('Оператор учёл известные детали', known, index), condition_id: 'known_details_considered'},
    {...check('Оператор уточнил недостающее до ответа', clarified, index, 2), condition_id: 'missing_details_clarified_before_answer'}
  ];
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
  result.na_assessment.initial_information_sufficient = false;
  result.checks = discoveryChecks(9);
  assert.equal((await run(input, [result]))[0].na, false);
  result.checks = [];
  await assert.rejects(run(input, [result]), /нет проверок/);
  delete result.na_assessment;
  await assert.rejects(run(input, [result]), /na_assessment.condition_met/);
});

test('N/A with evidence for sufficient initial details produces a consistent wire result', async () => {
  const input = conversation('p1-kz-005', ['02']);
  const result = row(input, '02', 0);
  result.na_assessment = {condition_met: true, initial_information_sufficient: true,
    reason: 'Клиент уже указал нужное действие; дополнительных уточнений не требовалось.'};
  assert.equal((await run(input, [result]))[0].na, true);
  result.checks = [check('Дополнительное уточнение', true, 0)];
  await assert.rejects(run(input, [result]), /N\/A несовместим/);
});

test('p1-ru-025: departure cannot override insufficient initial information for discovery', async () => {
  const input = conversation('p1-ru-025', ['02','04']);
  const discovery = row(input, '02', 9);
  discovery.na_assessment = {condition_met: true, initial_information_sufficient: false,
    reason: 'Данных для ответа изначально не было; клиент ушёл после вопроса оператора.'};
  discovery.checks = discoveryChecks(9);
  discovery.checks[1].reason = 'Оператор спросил «С чем помочь?», поскольку предмет обращения не был известен.';
  const consultation = row(input, '04', 10);
  consultation.na_assessment = {condition_met: true, reason: 'Клиент ушёл до формулировки запроса.'};
  const before = structuredClone(input);
  const [wire, other] = await run(input, [discovery, consultation], {inspect: body => {
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(data.na_policies.map(p => [p.criterion_id, p.key]), [['02','initial_information_sufficient']]);
    assert.match(data.na_policies[0].instructions, /Уход клиента не доказывает/);
    const assessment = body.generationConfig.responseJsonSchema.properties.results.items.properties.na_assessment;
    assert.ok(assessment.required.includes('initial_information_sufficient'));
  }});
  assert.equal(wire.na, false);
  assert.equal(wire.na_reason, null);
  assert.equal(wire.answer, true);
  assert.match(wire.explanation, /С чем помочь/);
  assert.equal(other.na, true); // Departure remains valid for its own configured condition.
  assert.equal(other.answer, null);
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(wire).sort(),
    ['criterion_id','answer','na','na_reason','explanation','evidence','checked_range'].sort());
});

test('insufficient information requires actual ordinary checks instead of an invented positive answer', async () => {
  const input = conversation('p1-ru-025', ['02']);
  const result = row(input, '02', 10);
  // Reproduce the old response: only a departure event and a contradictory N/A reason.
  result.na_assessment = {condition_met: true,
    reason: 'Клиент ушёл до формулировки запроса. Данных для ответа изначально не было.'};
  await assert.rejects(run(input, [result]), /initial_information_sufficient/);
  result.na_assessment.initial_information_sufficient = false;
  await assert.rejects(run(input, [result]), /нет проверок обязательных условий/);
  result.evidence = [{turnIndex: 9, quote: input.transcript[9].text}];
  result.checks = discoveryChecks(9, false, true);
  assert.equal((await run(input, [result]))[0].answer, false);
});

test('a sufficiency N/A cannot be evidenced solely by departure or an operator reply', async () => {
  const input = conversation('p1-ru-025', ['02']);
  for (const index of [9, 10]) {
    const result = row(input, '02', index);
    result.na_assessment = {condition_met: true, initial_information_sufficient: true,
      reason: 'Данных хватало с самого начала.'};
    await assert.rejects(run(input, [result]), /цитату клиента до первого ответа оператора/);
  }
  input.transcript.push({turnIndex: 11, timestamp: '00:30', speaker: 'client', text: 'Где тарифы?'});
  const result = row(input, '02', 11);
  result.na_assessment = {condition_met: true, initial_information_sufficient: true, reason: 'Клиент задал вопрос.'};
  await assert.rejects(run(input, [result]), /цитату клиента до первого ответа оператора/);
});

test('initial sufficiency requires a boolean fact, not a missing or coerced value', async () => {
  const input = conversation('p1-ru-025', ['02']);
  const result = row(input, '02', 9);
  result.checks = discoveryChecks(9);
  for (const fact of [null, undefined, 'false', 0, {}]) {
    result.na_assessment.initial_information_sufficient = fact;
    await assert.rejects(run(input, [result]), /initial_information_sufficient/);
  }
});

test('a sufficiency fact cannot introduce N/A against an explicit negative N/A assessment', async () => {
  const input = conversation('p1-kz-005', ['02']);
  const result = row(input, '02', 0);
  result.na_assessment = {condition_met: false, initial_information_sufficient: true,
    reason: 'Условие N/A не выполнено.'};
  await assert.rejects(run(input, [result]), /вывод N\/A противоречит/);
});

test('the sufficiency policy follows the configured condition across keys and transcript languages', async () => {
  for (const [language, question] of [
    ['RU', 'Где посмотреть публичные тарифы компании?'],
    ['KZ', 'Компанияның жария тарифтерін қайдан көруге болады?'],
    ['EN', 'Where can I find the public company tariffs?']
  ]) {
    const input = conversation('p1-ru-025', ['02']);
    input.language = language;
    input.checklist.criteria[0] = {...input.checklist.criteria[0], key: 'discovery-custom',
      naCondition: '  ДАННЫХ для ответа\nхватало с самого начала.  '};
    input.transcript = [
      {turnIndex: 0, timestamp: '00:00', speaker: 'client', text: question},
      {turnIndex: 1, timestamp: '00:01', speaker: 'operator', text: 'https://example.test/tariffs'}
    ];
    const result = row(input, 'discovery-custom', 0);
    result.na_assessment = {condition_met: true, initial_information_sufficient: true,
      reason: 'Исходный вопрос о месте публикации тарифов не требовал уточнения потребности.'};
    const [wire] = await run(input, [result], {inspect: body => {
      const data = JSON.parse(body.contents[0].parts[0].text);
      assert.equal(data.na_policies[0].criterion_id, 'discovery-custom');
    }});
    assert.equal(wire.criterion_id, 'discovery-custom');
    assert.equal(wire.na, true);
    assert.equal(wire.answer, null);
    assert.equal(wire.na_reason, result.na_assessment.reason);
  }
});

test('changing discovery N/A condition does not retain the old sufficiency rule', async () => {
  const input = conversation('p1-ru-025', ['02']);
  input.checklist.criteria[0] = {...input.checklist.criteria[0],
    naCondition: 'Клиент ушёл до формулировки запроса.'};
  const result = row(input, '02', 10);
  result.na_assessment = {condition_met: true, reason: 'Клиент покинул чат до описания вопроса.'};
  const [wire] = await run(input, [result], {inspect: body => {
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).na_policies, []);
  }});
  assert.equal(wire.na, true);
  assert.equal(wire.na_reason, result.na_assessment.reason);
});

test('disabling N/A keeps an ordinary assessment without applying a sufficiency policy', async () => {
  const input = conversation('p1-ru-025', ['02']);
  input.checklist.criteria[0] = {...input.checklist.criteria[0], allowNa: false};
  const result = row(input, '02', 9);
  result.checks = discoveryChecks(9);
  const [wire] = await run(input, [result], {inspect: body => {
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).na_policies, []);
  }});
  assert.equal(wire.na, false);
  assert.equal(wire.answer, true);
  result.na_assessment.condition_met = true;
  await assert.rejects(run(input, [result]), /N\/A не разрешён/);
});

test('p1-ru-025: discovery answer is AND of two independently evidenced conditions', async () => {
  const input = conversation('p1-ru-025', ['02']);
  for (const [known, clarified, expected] of [[true,true,true], [true,false,false], [false,true,false], [false,false,false]]) {
    const result = row(input, '02', 9);
    result.na_assessment.initial_information_sufficient = false;
    result.checks = discoveryChecks(9, known, clarified);
    // Provider order does not define the conjunction or the explanation order.
    result.checks.reverse();
    const before = structuredClone(result);
    const [wire] = await run(input, [result], {inspect: body => {
      const data = JSON.parse(body.contents[0].parts[0].text);
      assert.deepEqual(data.check_policies, [{criterion_id: '02', key: 'need_discovery', checks: [
        {id: 'known_details_considered', group: 1, condition: 'Оператор учёл известные детали'},
        {id: 'missing_details_clarified_before_answer', group: 2, condition: 'Оператор уточнил недостающее до ответа'}
      ]}]);
      const checkSchema = body.generationConfig.responseJsonSchema.properties.results.items.properties.checks.items;
      assert.ok(checkSchema.required.includes('condition_id'));
      assert.deepEqual(checkSchema.properties.condition_id.type, ['string', 'null']);
      assert.equal(Object.hasOwn(checkSchema.properties.condition_id, 'enum'), false);
      assert.match(body.systemInstruction.parts[0].text, /Не объединяй обязательные условия/);
    }});
    assert.equal(wire.answer, expected);
    assert.equal(wire.na, false);
    assert.equal(wire.na_reason, null);
    assert.match(wire.explanation, /Оператор учёл известные детали/);
    assert.match(wire.explanation, /Оператор уточнил недостающее до ответа/);
    assert.deepEqual(Object.keys(wire).sort(),
      ['criterion_id','answer','na','na_reason','explanation','evidence','checked_range'].sort());
    assert.deepEqual(result, before);
  }
});

test('the merged discovery check returned in 2.3.0 is rejected instead of counted as both conditions', async () => {
  const input = conversation('p1-ru-025', ['02']);
  const result = row(input, '02', 9);
  result.na_assessment.initial_information_sufficient = false;
  result.checks = [check('Оператор учёл известные детали и уточнил недостающее до ответа', true, 9)];
  await assert.rejects(run(input, [result]), {code: 'INVALID_MODEL_OUTPUT', status: 502,
    message: /нужны отдельные checks.*known_details_considered.*missing_details_clarified_before_answer/});
  result.checks[0].condition_id = 'known_details_considered';
  await assert.rejects(run(input, [result]), /нужны отдельные checks/);
});

test('duplicate, unknown and OR-grouped discovery conditions cannot replace a mandatory condition', async () => {
  const input = conversation('p1-ru-025', ['02']);
  const result = row(input, '02', 9);
  result.na_assessment.initial_information_sufficient = false;
  for (const badChecks of [
    [discoveryChecks(9)[0], discoveryChecks(9)[0]],
    [discoveryChecks(9)[0], {...discoveryChecks(9)[1], condition_id: 'other'}],
    [...discoveryChecks(9), discoveryChecks(9)[0]]
  ]) {
    result.checks = badChecks;
    await assert.rejects(run(input, [result]), /нужны отдельные checks/);
  }
  result.checks = discoveryChecks(9, true, false);
  result.checks[1].group = 1;
  await assert.rejects(run(input, [result]), /отдельные группы И/);
});

test('each mandatory discovery condition needs its own reason and cited turn', async () => {
  const input = conversation('p1-ru-025', ['02']);
  const result = row(input, '02', 9);
  result.na_assessment.initial_information_sufficient = false;
  for (const position of [0, 1]) {
    for (const patch of [{reason: ''}, {turnIndexes: []}, {turnIndexes: [8]}, {met: 'true'}]) {
      result.checks = discoveryChecks(9);
      Object.assign(result.checks[position], patch);
      await assert.rejects(run(input, [result]), /обоснования и доказательств/);
    }
  }
});

test('mandatory discovery checks follow the description even when the key is renamed', async () => {
  const input = conversation('p1-ru-025', ['02']);
  input.checklist.criteria[0] = {...input.checklist.criteria[0], key: 'custom-c2'};
  const result = row(input, 'custom-c2', 9);
  result.na_assessment.initial_information_sufficient = false;
  result.checks = discoveryChecks(9);
  const [wire] = await run(input, [result], {inspect: body => {
    assert.equal(JSON.parse(body.contents[0].parts[0].text).check_policies[0].criterion_id, 'custom-c2');
  }});
  assert.equal(wire.answer, true);
  assert.equal(wire.criterion_id, 'custom-c2');
  result.checks.pop();
  await assert.rejects(run(input, [result]), /нужны отдельные checks/);
});

test('a changed criterion definition does not retain old discovery obligations', async () => {
  const input = conversation('p1-ru-025', ['02']);
  input.checklist.criteria[0] = {...input.checklist.criteria[0], allowNa: false,
    description: 'Да — оператор задал открытый вопрос.'};
  const result = row(input, '02', 9);
  result.checks = [check('Оператор задал открытый вопрос', true, 9)];
  const [wire] = await run(input, [result], {inspect: body => {
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).check_policies, []);
  }});
  assert.equal(wire.answer, true);
  assert.equal(wire.na, false);
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

test('boolean=false requires checked_range even with a valid quote and omission=false', async () => {
  for (const key of ['01', 'custom-greeting']) {
    const input = JSON.parse(readFileSync(new URL('./mock-request.json', import.meta.url)));
    input.checklist.criteria = [{...input.checklist.criteria.find(c => c.key === '01'), key}];
    const result = row(input, key, 1);
    result.checks = [check('Приветствие', true, 1), check('Представление', false, 1, 2)];
    result.checked_range = null;
    result.omission = false;
    await assert.rejects(run(input, [result]), {status: 502, code: 'INVALID_MODEL_OUTPUT', message: /checked_range/});
    delete result.checked_range;
    await assert.rejects(run(input, [result]), {status: 502, code: 'INVALID_MODEL_OUTPUT', message: /checked_range/});
  }
});

test('boolean=false accepts inclusive ranges and still rejects invalid bounds or excluded evidence', async () => {
  const input = JSON.parse(readFileSync(new URL('./mock-request.json', import.meta.url)));
  input.checklist.criteria = input.checklist.criteria.filter(c => c.key === '01');
  const result = row(input, '01', 1);
  result.checks = [check('Приветствие', true, 1), check('Представление', false, 1, 2)];
  for (const span of [{start: 1, end: 1}, {start: 0, end: 1}]) {
    result.checked_range = span;
    const [wire] = await run(input, [result]);
    assert.equal(wire.answer, false);
    assert.equal(wire.na, false);
    assert.deepEqual(wire.checked_range, span);
    assert.deepEqual(Object.keys(wire).sort(),
      ['criterion_id','answer','na','na_reason','explanation','evidence','checked_range'].sort());
  }
  for (const span of [{start: 0, end: 0}, {start: 1, end: 0}, {start: -1, end: 1}, {start: 0, end: 2}]) {
    result.checked_range = span;
    await assert.rejects(run(input, [result]), {status: 502, code: 'INVALID_MODEL_OUTPUT'});
  }
});

test('positive boolean, N/A and numeric zero do not inherit the boolean=false range requirement', async () => {
  const greetingInput = conversation('p1-ru-025', ['01']);
  const greeting = row(greetingInput, '01', 9);
  greeting.checks = [check('Приветствие', true, 9), check('Представление', true, 9, 2)];
  greeting.checked_range = null;
  assert.equal((await run(greetingInput, [greeting]))[0].answer, true);

  const naInput = JSON.parse(readFileSync(new URL('./mock-request.json', import.meta.url)));
  naInput.checklist.criteria = naInput.checklist.criteria.filter(c => c.key === '03');
  const notApplicable = row(naInput, '03', 0);
  notApplicable.na_assessment = {condition_met: true, reason: 'Публичный вопрос о тарифах не требует идентификации.'};
  notApplicable.checked_range = null;
  const [naWire] = await run(naInput, [notApplicable]);
  assert.equal(naWire.na, true);
  assert.equal(naWire.answer, null);

  const scaleInput = JSON.parse(readFileSync(new URL('./mock-request.json', import.meta.url)));
  scaleInput.checklist.criteria = scaleInput.checklist.criteria.filter(c => c.key === '04');
  const zero = row(scaleInput, '04', 1);
  zero.levels = [{value: 0, met: true, reason: 'Дано только обещание уточнить, ответа по существу нет.'}];
  zero.checked_range = null;
  const [zeroWire] = await run(scaleInput, [zero]);
  assert.equal(zeroWire.answer, 0);
  assert.equal(zeroWire.checked_range, null);
});

test('p1-en-014: reaction to concern is separately required for empathy', async () => {
  const input = conversation('p1-en-014', ['05']);
  const result = row(input, '05', 12);
  result.checks = [check('Вежливость', true, 12), check('Реакция на опасение о проверке личности', false, 12, 2)];
  const [wire] = await run(input, [result]);
  assert.equal(wire.answer, false);
  assert.match(wire.explanation, /Реакция на опасение о проверке личности — не подтверждено/);
});

test('p1-en-015: selected level explains the communication failure', async () => {
  const input = conversation('p1-en-015', ['06']);
  const result = row(input, '06', 10);
  result.levels = levels(input, '06', 4, 'Клиент переспросил Settings where? после неясной инструкции.');
  result.answer = 10;
  const review = {requests: [{turnIndex: 10, answerTurnIndexes: [11], status: 'answered', summary: 'Уточнение непонятной инструкции'}],
    issues: [{turnIndexes: [9, 10], description: 'Клиент вынужден переспрашивать'}]};
  const [wire] = await run(input, [result], {review});
  assert.equal(wire.answer, 4);
  assert.match(wire.explanation, /переспросил/);
  result.levels = [];
  await assert.rejects(run(input, [result]), /ступень шкалы/);
});

test('flag computes OR across each checked violation, with no extra third-party condition', async () => {
  const input = conversation('p1-en-014', ['08']);
  const result = row(input, '08', 10);
  result.violations = [
    {violation:'Оскорбление',detected:false,reason:'Оскорбления нет.',turnIndexes:[10]},
    {violation:'Платная услуга в обход компании',detected:false,reason:'Такой услуги нет.',turnIndexes:[10]},
    {violation:'Раскрытие конфиденциальной информации',detected:true,reason:'Раскрыт статус счёта до проверки.',turnIndexes:[10]}
  ];
  const [wire] = await run(input, [result], {inspect: body => {
    assert.match(body.systemInstruction.parts[0].text, /Не добавляй «третьим лицам»/);
  }});
  assert.equal(wire.answer, true);
  assert.equal(wire.na, false);
  result.violations[2].detected = false;
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
  assert.equal((await run(input, [base], {review: {requests: [{turnIndex: 9, answerTurnIndexes: [], status: 'unanswered', summary: 'wrong role'}], issues: []}}))[0].answer,20);
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
  assert.throws(()=>validateResults([result],{...input,checklist:{...input.checklist,criteria:[input.checklist.criteria.find(c=>c.key==='06')]}}),/ступень/);
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

test('auxiliary routing review cannot invalidate correctly supported criterion answers', async () => {
  const input = conversation('p1-ru-025',['04']);
  const result = row(input,'04',10);
  result.na_assessment = {condition_met:true,reason:'Клиент ушёл до формулировки запроса.'};
  const events=[];
  let calls=0;
  const review={requests:[{turnIndex:0,answerTurnIndexes:[],status:'next_step',summary:'Подключить человека'}],issues:[]};
  const request=async()=>{calls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({review,results:[result]})}]}}]});};
  const [wire]=await evaluateGemini(input,{key:'test',model:'test',request,onEvent:e=>events.push(e)});
  assert.equal(calls,1);
  assert.equal(wire.na,true);
  assert.ok(events.some(e=>e.event==='review_warning'));
  assert.equal(events.at(-1).event,'evaluation_completed');
  result.evidence=[{turnIndex:10,quote:'invented quote'}];
  await assert.rejects(evaluateGemini(input,{key:'test',model:'test',request}),/цитата не совпала/);
});

test('absence of violations never becomes a positive flag via generic met=true', async () => {
  const input=conversation('p1-ru-025',['08']);
  const result=row(input,'08',9);
  result.violations=[
    {violation:'Оскорбление',detected:false,reason:'Оскорблений нет.',turnIndexes:[9]},
    {violation:'Платная услуга в обход компании',detected:false,reason:'Предложения нет.',turnIndexes:[9]},
    {violation:'Раскрытие конфиденциальной информации',detected:false,reason:'Раскрытия нет.',turnIndexes:[9]}
  ];
  const [wire]=await run(input,[result]);
  assert.equal(wire.answer,false);
  assert.match(wire.explanation,/не выявлено/);
  result.checks=[check('Грубые ошибки не выявлены',true,9)];
  await assert.rejects(run(input,[result]),/flag использует violations/);
});

test('one justified allowed scale level is sufficient without enumerating rejected levels', async () => {
  const input=conversation('p1-ru-025',['06']);
  const result=row(input,'06',9);
  result.levels=[{value:10,met:true,reason:'Единственная реплика оператора ясна и связна.'}];
  const [wire]=await run(input,[result]);
  assert.equal(wire.answer,10);
  assert.equal(wire.na,false);
  assert.match(wire.explanation,/ясна и связна/);
  result.levels=[{value:20,met:true,reason:'Чужая шкала'}];
  await assert.rejects(run(input,[result]),/ступень/);
  result.levels=[{value:10,met:true,reason:'Первый'},{value:10,met:true,reason:'Повтор'}];
  await assert.rejects(run(input,[result]),/повторная ступень/);
});
