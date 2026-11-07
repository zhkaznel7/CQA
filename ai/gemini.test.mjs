import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateGemini} from './gemini.mjs';

const input = {channel:'agent chat', language:'KZ', transcript:[{turnIndex:0,text:'Сәлем!',speaker:'operator',timestamp:'00:00'}],
  checklist:{instructions:[], criteria:[{key:'new-scale',type:'scale',scaleSteps:[{value:0},{value:4}],allowNa:false}]}};
const row = {criterion_id:'new-scale',answer:4,na:false,na_reason:null,explanation:'Есть приветствие.',
  evidence:[{turnIndex:0,quote:'Сәлем!'}],checked_range:null,omission:false};
function run(rows,status=200) {
  return evaluateGemini(input,{key:'test', model:'test',request: async (_url, init) => {
    assert.deepEqual(JSON.parse(JSON.parse(init.body).contents[0].parts[0].text).criteria, input.checklist.criteria);
    return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(rows)}]}}]}),{status});
  }});
}
test('custom checklist, exact original evidence, public result fields', async () => {
  const {omission, ...expected} = row;
  assert.deepEqual(await run([row]),[expected]);
});
test('reject invalid steps, N/A, citations, keys and missing ranges', async () => {
  for (const patch of [{answer:2},{na:true,answer:null,na_reason:'нет'},{evidence:[{turnIndex:0,quote:'Hello'}]},
      {criterion_id:'other'},{omission:true},{checked_range:{start:0,end:3}}]) {
    await assert.rejects(run([{...row,...patch}]),{status:502});
  }
});
test('quota and upstream timeout', async () => {
  await assert.rejects(run([],429),{status:503, message:/Google HTTP 429/});
  await assert.rejects(run([],503),{status:503, message:/Google HTTP 503/});
  await assert.rejects(run([],504),{status:504});
});
test('401 exposes only the recognized provider reason', async () => {
  const request = async () => Response.json({error:{message:'sensitive',details:[{reason:'ACCESS_TOKEN_TYPE_UNSUPPORTED'}]}},{status:401});
  await assert.rejects(evaluateGemini(input,{key:'test',model:'test',request}),
    err => err.status === 502 && err.message.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') && !err.message.includes('sensitive'));
});
test('wrong quote identifies the criterion and keeps the original evidence private', async () => {
  await assert.rejects(run([{...row, evidence:[{turnIndex:0,quote:'invented quote'}]}]),
    {code:'INVALID_MODEL_OUTPUT',message:/критерий new-scale, цитата не совпала/});
});

test('mock-ru-001: incomplete greeting, omission range and alternative conditions', async () => {
  const {readFileSync} = await import('node:fs');
  const fixture = JSON.parse(readFileSync(new URL('./mock-request.json', import.meta.url)));
  fixture.checklist.criteria = fixture.checklist.criteria.filter(c => ['01','04'].includes(c.key));
  const {validateResults} = await import('./gemini.mjs');
  const evidence = [{turnIndex:1,quote:fixture.transcript[1].text}];
  const greeting = {...row, criterion_id:'01', answer:true, evidence, omission:true,
    checks:[{group:1,condition:'Приветствие',met:true},{group:2,condition:'Представление',met:false}],
    checked_range:{start:1,end:1}};
  const consultation = {...row,criterion_id:'04',answer:0,evidence,omission:true,checked_range:{start:0,end:1}};
  const results = validateResults([greeting,consultation],fixture);
  assert.equal(results[0].answer,false);
  assert.deepEqual(results[1].checked_range,{start:0,end:1});
  greeting.checks[1].group = 1;
  assert.equal(validateResults([greeting,consultation],fixture)[0].answer,true);
  greeting.checks = [];
  assert.throws(() => validateResults([greeting,consultation],fixture),/нет проверок/);
});

test('optional boolean: separate schema paths for applicable and N/A', async () => {
  const criterion = {key:'02',type:'boolean',allowNa:true,naCondition:'Данных хватало'};
  const fixture = {...input,checklist:{instructions:[],criteria:[criterion]}};
  const request = async (_url, init) => {
    const variants = JSON.parse(init.body).generationConfig.responseJsonSchema.items.anyOf;
    const [applicable, na] = variants.map(s => s.properties);
    assert.deepEqual(applicable.na.enum,[false]);
    assert.equal(applicable.checks.minItems,1);
    assert.deepEqual(na.na.enum,[true]);
    assert.equal(na.checks.maxItems,0);
    const result = {...row,criterion_id:'02',na:true,na_reason:'Данных хватало',answer:null,checks:[]};
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify([result])}]}}]});
  };
  const [result] = await evaluateGemini(fixture,{key:'test',model:'test',request});
  assert.equal(result.na,true);
  assert.equal(result.answer,null);
});
