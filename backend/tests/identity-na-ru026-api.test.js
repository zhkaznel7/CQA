import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import test from 'node:test';
import {createApp} from '../src/app.js';
import {prisma} from '../src/database/client.js';
import {env} from '../src/config/env.js';
import {createMockAiClient} from '../src/ai-client/mock-client.js';
import {createHttpAiClient} from '../src/ai-client/http-client.js';
import {checklistService} from '../src/modules/checklists/checklists.service.js';
import {createChecklistSchema,versionChecklistSchema} from '../src/modules/checklists/checklists.schema.js';

test('p1-ru-026 HTTP: identity applicability is separate from missing closure, persistence and safe failures',async t=>{
 assert.match(new URL(env.DATABASE_URL).pathname,/test/i);
 const source=JSON.parse(await readFile(new URL('./fixtures/p1-ru-026.json',import.meta.url)));
 const official=JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json',import.meta.url)));
 const namespace='funding-'+randomUUID(),rollback=new Error('ROLLBACK_FUNDING_FIXTURES'),mock=createMockAiClient();
 let server,ai,naKeys=['03','07'],badQuoteKey,calls=0;
 try{
  ai=createServer(async(req,res)=>{
   const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));calls++;
   const output=await mock.evaluate(input);
   for(const row of output.results){
    // Deliberately all-zero synthetic answers, not claimed Gemini decisions or a quality judgement.
    row.answer=input.checklist.criteria.find(c=>c.key===row.criterion_id).type==='scale'?0:false;
    row.checked_range={start:0,end:input.transcript.length-1};
    if(naKeys.includes(row.criterion_id))Object.assign(row,{answer:null,na:true,
     na_reason:'SYNTHETIC N/A fixture; not the real Gemini response',
     evidence:[{turnIndex:row.criterion_id==='03'?0:input.transcript.length-1,
      quote:row.criterion_id==='03'?input.transcript[0].text:input.transcript.at(-1).text}]});
    if(row.criterion_id===badQuoteKey)row.evidence=[{turnIndex:0,quote:'SYNTHETIC QUOTE NOT IN SOURCE'}];
   }
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(output));
  }).listen(0,'127.0.0.1');await once(ai,'listening');
  await assert.rejects(prisma.$transaction(async tx=>{
   let sequence=0;
   const database=new Proxy(tx,{get(target,key){
    if(key==='$transaction')return async action=>{
     if(typeof action!=='function')return Promise.all(action);const name='funding_'+(++sequence);await tx.$executeRawUnsafe('SAVEPOINT '+name);
     try{const result=await action(tx);await tx.$executeRawUnsafe('RELEASE SAVEPOINT '+name);return result;}
     catch(error){await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT '+name);await tx.$executeRawUnsafe('RELEASE SAVEPOINT '+name);throw error;}
    };const value=target[key];return typeof value==='function'?value.bind(target):value;
   }});
   const checklist=await checklistService(database).create(createChecklistSchema.parse({...official,key:namespace}));
   server=createApp({database,aiClient:createHttpAiClient({AI_BASE_URL:'http://127.0.0.1:'+ai.address().port,AI_SERVICE_KIND:'mock'})}).listen(0,'127.0.0.1');await once(server,'listening');
   const origin='http://127.0.0.1:'+server.address().port;
   async function request(path,body){const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
   async function fixture(mutate=()=>{},checklistId=checklist.id){const record=structuredClone(source);mutate(record);const conversation=await tx.conversation.create({data:{externalId:record.conversation_id,groupId:namespace+'-'+(++sequence),language:record.language,channel:record.channel,transcript:record.transcript.map((turn,turnIndex)=>({...turn,turnIndex}))}});return{conversation,input:{conversationId:conversation.id,checklistId}};}
   async function denied(item,keys,code='AI_NA_UNCONFIRMED'){const response=await request('/api/evaluations',item.input);assert.equal(response.status,502);assert.equal(response.body.error.code,code);assert.deepEqual(response.body.error.details,keys.map(criterionKey=>({criterionKey})));assert.equal(await tx.evaluation.count({where:item.input}),0);return response;}
   let item,saved;
   await t.test('03=N/A is independently valid, but operator-closed 07=N/A alone blocks persistence',async()=>{
    item=await fixture();const before=calls;await denied(item,['07']);assert.equal(calls,before+1);
   });
   await t.test('explicit corrected mock 07=false with 03=N/A saves all eight results without manual facts',async()=>{
    naKeys=['03'];const response=await request('/api/evaluations',item.input);assert.equal(response.status,201);saved=response.body.data;
    assert.equal(saved.results.length,8);assert.equal(saved.results.find(r=>r.criterionKey==='03').isNa,true);
    const closure=saved.results.find(r=>r.criterionKey==='07');assert.equal(closure.isNa,false);assert.equal(closure.answer,false);
    assert.equal(saved.score.applicableWeight,80);assert.equal(saved.score.total,0);
    assert.equal(await tx.applicabilityConfirmation.count({where:{conversationId:item.conversation.id}}),0);
   });
   await t.test('GET and repeat preserve original explanations/evidence/source, and never repeat AI',async()=>{
    assert.deepEqual((await request('/api/evaluations/'+saved.id)).body.data,saved);
    const before=calls,reused=await request('/api/evaluations',item.input);assert.equal(reused.status,200);assert.equal(reused.body.reused,true);assert.deepEqual(reused.body.data,saved);assert.equal(calls,before);
    assert.deepEqual((await tx.conversation.findUniqueOrThrow({where:{id:item.conversation.id}})).transcript.map(({turnIndex,...turn})=>turn),source.transcript);
   });
   await t.test('protected disclosure with both N/A claims reports independent 03 and 07 failures',async()=>{
    naKeys=['03','07'];const other=await fixture(r=>r.transcript.splice(-1,0,{speaker:'client',timestamp:'03:50',text:'Пришлите реквизиты моего личного счёта.'}));await denied(other,['03','07']);
   });
   await t.test('a single invalid 07 is not silently replaced by false or accepted as an interruption',async()=>{
    naKeys=['07'];await denied(await fixture(),['07']);
   });
   await t.test('the same screenshot tail with an earlier protected request still rejects identity N/A',async()=>{
    naKeys=['03'];const other=await fixture(r=>r.transcript.unshift({speaker:'client',timestamp:'00:00',text:'Пришлите мне номер моего счёта и остаток.'}));
    assert.deepEqual(other.conversation.transcript.slice(-3).map(({turnIndex,...turn})=>turn),source.transcript.slice(-3));
    await denied(other,['03']);
   });
   await t.test('personal values and unexpected authenticated metadata cannot grant automatic identity N/A',async()=>{
    naKeys=['03'];for(const mutate of [r=>r.transcript.splice(-1,0,{speaker:'operator',timestamp:'03:50',text:'Ваш баланс 99999 тенге.'}),r=>{r.transcript[11].metadata={authenticated:true};}]){
     const result=await denied(await fixture(mutate),['03']);assert.ok(!JSON.stringify(result.body).includes('99999'));assert.ok(!JSON.stringify(result.body).includes('authenticated'));
    }
   });
   await t.test('technical evidence failure identifies 07 and remains distinct from N/A applicability',async()=>{
    naKeys=['03','07'];badQuoteKey='07';try{await denied(await fixture(),['07'],'AI_INVALID_EVIDENCE');}finally{badQuoteKey=undefined;}
   });
   await t.test('unchanged identity rule in checklist v2 remains applicable, previous evaluation is immutable',async()=>{
    naKeys=['03'];const amendment=JSON.parse(await readFile(new URL('../prisma/seed/call-na-amendment.json',import.meta.url)));const{key,...body}=structuredClone(official);
    Object.assign(body.criteria[0],{allowNa:true,naCondition:amendment.naCondition,applicabilityRule:amendment.applicabilityRule});
    const version=await checklistService(database).version(checklist.id,versionChecklistSchema.parse(body));const other=await fixture(()=>{},version.id);const response=await request('/api/evaluations',other.input);
    assert.equal(response.status,201);assert.equal(response.body.data.results.find(r=>r.criterionKey==='03').isNa,true);assert.equal(response.body.data.results.find(r=>r.criterionKey==='07').answer,false);
    assert.deepEqual((await request('/api/evaluations/'+saved.id)).body.data,saved);
   });
   throw rollback;
  },{timeout:60000}),error=>error===rollback);
 }finally{await new Promise(r=>server?server.close(r):r());await new Promise(r=>ai?ai.close(r):r());await prisma.$disconnect();}
});
