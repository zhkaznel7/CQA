import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createOfficialResults,mockModel} from '../src/modules/exports/official-results.js';
import {officialResultsSchema,officialCriterionKeys} from '../src/modules/exports/results.schema.js';
import {createAiExportInputs} from '../src/modules/exports/ai-inputs.js';
import {parseChecklist} from '../src/modules/scoring/scoring.schema.js';
import {calculateScore} from '../src/modules/scoring/scoring.service.js';

const official=JSON.parse(readFileSync(new URL('../prisma/seed/official-checklist.json',import.meta.url)));
function fixture(){
 const id=randomUUID();const checklist={id,key:official.key,version:1,name:official.name,config:{schemaVersion:1,sections:official.sections,instructions:official.instructions??[]},
  criteria:official.criteria.map((c,i)=>({id:randomUUID(),key:c.key,name:c.name,maxPoints:c.type==='flag'?0:c.type==='boolean'?1:Math.max(...c.scaleSteps.map(s=>s.value)),config:{...c,position:i,scaleSteps:c.scaleSteps??[],naCondition:c.naCondition??null}}))};
 const conversation={id:randomUUID(),externalId:'source-'+randomUUID(),channel:'agent chat',language:'RU',transcript:[
  {turnIndex:0,speaker:'bot',timestamp:'00:00',text:'Synthetic bot context'},
  {turnIndex:1,speaker:'client',timestamp:'00:01',text:'Synthetic client question'},
  {turnIndex:2,speaker:'operator',timestamp:'00:02',text:'Synthetic answer'},
 ]};
 const results=checklist.criteria.map(c=>({criterion:{key:c.key},isNa:false,answer:c.config.type==='scale'?Math.max(...c.config.scaleSteps.map(s=>s.value)):false,naReason:null,
  explanation:'Synthetic rationale',evidence:[{turnIndex:2,quote:'Synthetic answer'}],checkedRange:c.config.type==='boolean'?{start:0,end:2}:null}));
 const evaluation={id:randomUUID(),conversationId:conversation.id,checklistId:id,status:'COMPLETED',provider:'mock',conversation,results};
 evaluation.score=calculateScore(parseChecklist(checklist),results.map(r=>({criterionKey:r.criterion.key,value:r.answer})));
 return {teamName:'AUDIT SYNTHETIC ONLY',model:mockModel,manifest:[conversation],evaluations:[evaluation],checklist,expectedCount:1,allowMock:true};
}

test('exports reject mixed dataset groups even when their source IDs and content match',()=>{
 const input=rawSnapshot(fixture()); input.groupId='DEV'; input.evaluations[0].conversation.groupId='DEV';
 assert.equal(createOfficialResults(input).results[0].status,'ok');
 const transfer=createAiExportInputs({file:createOfficialResults(input),evaluations:input.evaluations,checklist:input.checklist,dataset:'dev',groupId:'DEV'});
 assert.equal(transfer.manifest.group_id,'DEV');
 const other=structuredClone(input.evaluations[0]);other.id=randomUUID();other.conversationId=randomUUID();other.conversation={...other.conversation,id:other.conversationId,groupId:'test_second'};
 input.evaluations.push(other);
 assert.throws(()=>createOfficialResults(input),/another dataset group/);
 assert.throws(()=>createAiExportInputs({file:{results:[]},evaluations:input.evaluations,checklist:input.checklist,dataset:'dev',groupId:'DEV'}),/another dataset group/);
 delete input.groupId;assert.throws(()=>createOfficialResults(input),/Duplicate external ID/);
});
test('official export is strict version 1.0, eight named criteria, source IDs, weighted score and one-based turns',()=>{
 const input=fixture(),before=structuredClone(input),file=createOfficialResults(input);assert.deepEqual(input,before);
 assert.equal(file.schema_version,'1.0');assert.equal(file.results[0].conversation_id,input.manifest[0].externalId);assert.equal(file.results[0].status,'ok');
 assert.deepEqual(file.results[0].criteria.map(c=>c.criterion_id),officialCriterionKeys);
 assert.deepEqual(file.results[0].criteria[0].evidence_turns,[1,2,3]);assert.deepEqual(file.results[0].criteria[3].evidence_turns,[3]);
 assert.equal(file.results[0].score.final_score,35);assert.equal(file.results[0].score.critical_flag,false);officialResultsSchema.parse(JSON.parse(JSON.stringify(file)));
});
test('unconfirmed contact N/A becomes an error without changing internal N/A or source ID',()=>{
 const input=fixture();input.checklist.criteria[0].config.allowNa=true;input.checklist.criteria[0].config.naCondition='Verified missing recording start';
 Object.assign(input.evaluations[0].results[0],{isNa:true,answer:null,naReason:'Verified missing start'});
 const result=createOfficialResults(input).results[0];assert.equal(result.status,'error');assert.equal(result.conversation_id,input.manifest[0].externalId);assert.deepEqual(result.criteria,[]);assert.equal(result.score,null);assert.match(result.error,/contact=null/);
 assert.equal(input.evaluations[0].results[0].answer,null);assert.equal(input.evaluations[0].results[0].isNa,true);
});

function confirmedCall(channel='voice call'){
 const input=fixture();input.dataset='dev';input.checklist.version=2;
 input.manifest[0].channel=channel;
 Object.assign(input.checklist.criteria[0].config,{allowNa:true,naCondition:'Independently confirmed missing recording start',applicabilityRule:{kind:'recording_start_missing',channels:['voice','call']}});
 Object.assign(input.evaluations[0].results[0],{isNa:true,answer:null,naReason:'Начало записи отсутствует.'});
 input.evaluations[0].score=calculateScore(parseChecklist(input.checklist),input.evaluations[0].results.map(r=>r.isNa?{criterionKey:r.criterion.key,isNa:true,naConditionMet:true,naReason:r.naReason}:{criterionKey:r.criterion.key,value:r.answer}));
 input.confirmations=[{conversationId:input.manifest[0].id,checklistId:input.checklist.id,criterionKey:'01',rule:'recording_start_missing',confirmedBy:'synthetic-reviewer',reference:'Independently verified synthetic recording metadata'}];
 return input;
}
function rawSnapshot(input){
 const e=input.evaluations[0];e.aiResponse={conversation_id:e.conversationId,checklist_id:input.checklist.id,checklist_version:input.checklist.version,
  results:e.results.map(r=>({criterion_id:r.criterion.key,answer:r.answer,na:r.isNa,na_reason:r.naReason,explanation:r.explanation,evidence:structuredClone(r.evidence),checked_range:structuredClone(r.checkedRange)}))};
 return input;
}
test('a custom call exception cannot produce a contact=null submission', () => {
 const input=rawSnapshot(confirmedCall());
 const file=createOfficialResults(input);
 assert.equal(file.results[0].status,'error');
 officialResultsSchema.parse(file);
});
test('DEV contact N/A rejects missing, wrong-version or wrong-rule confirmation and all text channels',()=>{
 for(const mutate of [i=>i.confirmations=[],i=>i.confirmations[0].checklistId=randomUUID(),i=>i.confirmations[0].rule='verified_condition',i=>i.confirmations[0].confirmedBy='',i=>i.manifest[0].channel='agent chat',i=>i.manifest[0].channel='chat',i=>i.manifest[0].channel='email',i=>i.dataset=undefined]){
  const input=confirmedCall();mutate(input);const row=createOfficialResults(input).results[0];assert.equal(row.status,'error');assert.equal(row.conversation_id,input.manifest[0].externalId);assert.equal(row.score,null);
 }
});
test('PROD voice source is rejected and PROD text contact N/A is never silently converted',()=>{
 const input=confirmedCall();input.dataset='prod';assert.throws(()=>createOfficialResults(input));input.manifest[0].channel='agent chat';assert.equal(createOfficialResults(input).results[0].status,'error');
});
test('all explicit ranges and N/A rationale use the agreed AI-export projection',()=>{
 const input=fixture();input.evaluations[0].results[0].answer=true;
 input.evaluations[0].results[3].checkedRange={start:0,end:2};
 Object.assign(input.evaluations[0].results[1],{isNa:true,answer:null,naReason:'Independent reason',explanation:' Explanation '});
 input.evaluations[0].score=calculateScore(parseChecklist(input.checklist),input.evaluations[0].results.map(r=>r.isNa?{criterionKey:r.criterion.key,isNa:true,naConditionMet:true,naReason:r.naReason}:{criterionKey:r.criterion.key,value:r.answer}));
 const file=createOfficialResults(input);assert.deepEqual(file.results[0].criteria[0].evidence_turns,[1,2,3]);assert.deepEqual(file.results[0].criteria[3].evidence_turns,[1,2,3]);assert.equal(file.results[0].criteria[1].rationale,'Independent reason  Explanation');
 input.evaluations[0].results[1].naReason=' Explanation ';input.evaluations[0].score.criteria.find(c=>c.key==='02').naReason=' Explanation ';
 assert.equal(createOfficialResults(input).results[0].criteria[1].rationale,'Explanation');
});
test('missing model provenance and unfinished legacy rows remain error records with source IDs',()=>{
 for(const status of ['DRAFT','COMPLETED']){const input=fixture();input.evaluations[0].status=status;input.evaluations[0].provider=null;const file=createOfficialResults(input);assert.equal(file.results[0].status,'error');assert.equal(file.results[0].conversation_id,input.manifest[0].externalId);}
});
test('AI compatibility inputs preserve full saved Backend scores/version and remap only offline conversation ID',()=>{
 const input=rawSnapshot(fixture()),before=structuredClone(input),file=createOfficialResults(input);
 const transfer=createAiExportInputs({file,evaluations:input.evaluations,checklist:input.checklist,dataset:'dev'});
 assert.equal(transfer.responses[0].conversation_id,input.manifest[0].externalId);assert.equal(transfer.scores[0].conversation_id,input.manifest[0].externalId);
 assert.equal(transfer.scores[0].checklist_version,1);assert.deepEqual(transfer.scores[0].score,input.evaluations[0].score);
 assert.equal(transfer.manifest.synthetic,true);assert.deepEqual(input,before);
 transfer.scores[0].score.total=99;assert.equal(input.evaluations[0].score.total,35);
});
test('cross-version or contradictory saved AI response cannot be exported as success or transferred',()=>{
 for(const mutate of [i=>i.evaluations[0].aiResponse.checklist_version=99,i=>i.evaluations[0].aiResponse.conversation_id=randomUUID(),i=>i.evaluations[0].aiResponse.results[0].explanation='Different source']){
  const input=rawSnapshot(confirmedCall());mutate(input);assert.equal(createOfficialResults(input).results[0].status,'error');
  const fakeFile={results:[{conversation_id:input.manifest[0].externalId,status:'ok'}]};assert.throws(()=>createAiExportInputs({file:fakeFile,evaluations:input.evaluations,checklist:input.checklist,dataset:'dev'}));
 }
});
test('offline error packets preserve IDs and expose no arbitrary provider error body',()=>{
 const input=fixture();input.manifest.push({...input.manifest[0],externalId:'missing-source'});input.expectedCount=2;
 const file=createOfficialResults(input);const transfer=createAiExportInputs({file:{results:[file.results[1]]},evaluations:[],checklist:input.checklist,dataset:'dev'});
 assert.deepEqual(transfer.responses,[{conversation_id:'missing-source',error:{code:'BACKEND_EXPORT_ERROR'}}]);assert.deepEqual(transfer.scores,[]);assert.equal(transfer.manifest.records[0].status,'error');
});
test('official Appendix example calculates 85.38 and critical never zeroes the score',()=>{
 const input=fixture();const values=[true,null,null,15,true,7,true,false];
 input.evaluations[0].results.forEach((row,i)=>Object.assign(row,{answer:values[i],isNa:values[i]===null,naReason:values[i]===null?'Synthetic confirmed condition':null}));
 const answers=input.evaluations[0].results.map(r=>r.isNa?{criterionKey:r.criterion.key,isNa:true,naConditionMet:true,naReason:r.naReason}:{criterionKey:r.criterion.key,value:r.answer});
 input.evaluations[0].score=calculateScore(parseChecklist(input.checklist),answers);
 assert.equal(createOfficialResults(input).results[0].score.final_score,85.38);
 input.evaluations[0].results[7].answer=true;answers[7].value=true;input.evaluations[0].score=calculateScore(parseChecklist(input.checklist),answers);
 assert.deepEqual(createOfficialResults(input).results[0].score,{final_score:85.38,critical_flag:true});
});
test('missing and incomplete evaluations remain present as errors, never fake zero scores',()=>{
 const input=fixture();input.manifest.push({...input.manifest[0],externalId:'missing'});input.expectedCount=2;
 const result=createOfficialResults(input);assert.equal(result.results.length,2);assert.equal(result.results[1].status,'error');assert.equal(result.results[1].score,null);
 input.evaluations[0].status='DRAFT';assert.ok(createOfficialResults(input).results.every(r=>r.status==='error'));
});
test('duplicate/missing IDs or wrong dataset size reject the file',()=>{
 for(const mutate of [i=>i.expectedCount=65,i=>{i.manifest.push(i.manifest[0]);i.expectedCount=2;},i=>i.manifest[0].externalId='']){const input=fixture();mutate(input);assert.throws(()=>createOfficialResults(input));}
});
test('mock results cannot be labelled Gemini or exported without explicit consent',()=>{
 const input=fixture();assert.throws(()=>createOfficialResults({...input,allowMock:false}));assert.throws(()=>createOfficialResults({...input,model:{mode:'external_api',name:'Gemini'}}));
});
test('wrong quote, indices, range and absent-action support become errors',()=>{
 for(const mutate of [r=>r.evidence[0].turnIndex=-1,r=>r.evidence[0].turnIndex=3,r=>r.evidence[0].quote='Invented',r=>r.checkedRange={start:0,end:1},r=>r.checkedRange=null]){
  const input=fixture();mutate(input.evaluations[0].results[0]);assert.equal(createOfficialResults(input).results[0].status,'error');}
});
test('unsupported edited criterion and corrupted score cannot become official success',()=>{
 const input=fixture();input.evaluations[0].score.total=99;assert.equal(createOfficialResults(input).results[0].status,'error');
 const changed=fixture();changed.checklist.criteria[0].key='replaced-contact';assert.equal(createOfficialResults(changed).results[0].status,'error');
});
test('official schema rejects null contact, zero-based evidence, duplicated criteria and flag mismatch',()=>{
 for(const mutate of [f=>f.results[0].criteria[0].value=null,f=>f.results[0].criteria[0].evidence_turns=[0],f=>f.results[0].criteria[0].evidence_turns=[],f=>f.results[0].criteria[1]=f.results[0].criteria[0],f=>f.results[0].score.critical_flag=true]){
  const file=createOfficialResults(fixture());mutate(file);assert.equal(officialResultsSchema.safeParse(file).success,false);}
});
test('UTF-8 RU/KZ/EN rationales and full 65/10 synthetic manifests round-trip',()=>{
 for(const size of [65,10]){const input=fixture(),records=Array.from({length:size},()=>fixture());input.manifest=records.map(r=>r.manifest[0]);input.evaluations=records.map(r=>({...r.evaluations[0],checklistId:input.checklist.id}));input.expectedCount=size;
  for(const [index,evaluation] of input.evaluations.entries()){evaluation.score={...evaluation.score,checklistId:input.checklist.id};evaluation.results[0].explanation=['Тест','Сынақ','Test'][index%3];}
  const file=createOfficialResults(input);assert.equal(file.results.length,size);assert.ok(file.results.every(r=>r.status==='ok'));assert.deepEqual(JSON.parse(Buffer.from(JSON.stringify(file),'utf8').toString('utf8')),file);}
});
