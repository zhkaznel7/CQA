import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateLocal, official} from './local.mjs';
import {evaluateGemini, validateResults} from './gemini.mjs';
import {startServer} from './http.mjs';
import {once} from 'node:events';

function fixture(language, turns, criteria = official.criteria) {
  return {conversation_id:'demo', channel:'agent chat', language,
    transcript: turns.map(([speaker,text],turnIndex)=>({speaker,text,turnIndex,timestamp:'00:0'+turnIndex})),
    checklist:{...official, id:'fixture',version:1,criteria}};
}
const request = fixture('RU', [
  ['client','Где посмотреть тарифы?'], ['bot','Здравствуйте, меня зовут Бот.'],
  ['operator','Здравствуйте, меня зовут Анна. Откройте раздел тарифов.'],
  ['client','Спасибо!'], ['operator','Если появятся вопросы, обращайтесь. До свидания!'],
]);

test('all official criteria give allowed answers, original quotes and consistent N/A',()=>{
  const rows = evaluateLocal(request);
  assert.deepEqual(rows.map(r=>r.answer), [true,null,null,20,true,10,true,false]);
  for(const r of rows) {
    assert.equal(r.na, r.answer === null);
    assert.equal(r.na, !!r.na_reason);
    assert.ok(r.evidence.length);
    assert.ok(r.evidence.every(e=>request.transcript[e.turnIndex].text.includes(e.quote)));
  }
});

test('operator identity and client language determine greeting; bot insults do not set the critical flag',()=>{
  const kz = fixture('KZ',[['bot','Сәлеметсіз бе, менің атым Бот. You are an idiot.'],
    ['operator','Здравствуйте! Меня зовут оператор.'], ['client','Рақмет!']]);
  const rows = evaluateLocal(kz);
  assert.equal(rows[0].answer,false);
  assert.equal(rows[7].answer,false);
  assert.deepEqual(rows[0].checked_range, {start:0,end:1});
  kz.transcript[1].text = 'Сәлеметсіз бе, менің атым Самал.';
  assert.equal(evaluateLocal(kz)[0].answer,true);
});

test('English personal transfer offer raises an independent flag',()=>{
  const en = fixture('EN',[['client','How do I transfer money?'],['operator',"Hello, I'm Pat. Transfer it to my account."]]);
  const rows = evaluateLocal(en);
  assert.equal(rows[0].answer,true);
  assert.equal(rows[7].answer,true);
  assert.equal(rows[7].evidence[0].turnIndex,1);
});

test('checklist changes apply to custom phrases, key changes and scale values',()=>{
  const custom = {...official.criteria[0], key:'thanks',description:'Оператор использует фразу «тарифов»'};
  const newScale = {...official.criteria[3], key:'advice', scaleSteps:official.criteria[3].scaleSteps.map(s=>({...s,value:2*s.value}))};
  assert.deepEqual(evaluateLocal({...request,checklist:{criteria:[custom,newScale]}}).map(r=>[r.criterion_id,r.answer]),
    [['thanks',true],['advice',40]]);
  assert.throws(()=>evaluateLocal({...request,checklist:{criteria:[{...custom,description:'Оцените новый сценарий.'}]}}),
    e=>e.code==='LOCAL_RULE_UNSUPPORTED');
});

test('Gemini receives the configured rubric, quotes must match and a missed action requires a range',async()=>{
  const c = {...official.criteria[0],key:'custom',description:'Поприветствовал клиента.'};
  const input = {...request,checklist:{...official,criteria:[c]}};
  const modelRow = {criterion_id:c.key, value:'yes', rationale:'Оператор поздоровался.',
    evidence_turns:[2], checked_range:{start:2,end:2}};
  const results = await evaluateGemini(input,{model:'fixture',key:'fixture',request:async (_url,init)=>{
    const body = JSON.parse(init.body);
    assert.deepEqual(body.generationConfig.responseJsonSchema.properties.results.items.properties.value.enum,['yes','no']);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text).criteria,[c]);
    const output = {results:[modelRow]};
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
  }});
  assert.equal(results[0].answer,true);
  assert.equal(results[0].evidence[0].quote,input.transcript[2].text);
  assert.throws(()=>validateResults([{...modelRow,value:'N/A'}],input),/ответ/);
  assert.throws(()=>validateResults([{...modelRow,evidence_turns:[999]}],input),/доказательство/);
  assert.throws(()=>validateResults([{...modelRow,value:'no',checked_range:null}],input),/checked_range/);
});

test('HTTP carries model identity and a distinct error code for unsupported criteria',async t=>{
  const {PORT, HOST} = process.env;
  process.env.PORT='0';
  process.env.HOST='127.0.0.1';
  const server=startServer({mode:'local',name:'CQA rules-v1'},evaluateLocal);
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  if(PORT===undefined) delete process.env.PORT; else process.env.PORT=PORT;
  if(HOST===undefined) delete process.env.HOST; else process.env.HOST=HOST;
  await once(server,'listening');
  const url='http://127.0.0.1:'+server.address().port+'/v1/evaluations';
  const post=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response=await post(request);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-cqa-model-name'),'CQA rules-v1');
  assert.equal(response.headers.get('x-cqa-model-mode'),'local');
  assert.deepEqual((await response.json()).results,evaluateLocal(request));
  const unsupported=structuredClone(request);
  unsupported.checklist.criteria[0].description='Учесть новое правило.';
  const error=await post(unsupported);
  assert.equal(error.status,422);
  assert.equal(error.headers.get('x-cqa-error-code'),'LOCAL_RULE_UNSUPPORTED');
});
