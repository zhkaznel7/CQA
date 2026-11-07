import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runT05,MODEL} from './t05-once.mjs';
import {EVALUATOR_SHA256} from '../gemini.mjs';

async function temporary(run) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'cqa-t05-'));
  try {await run(directory);} finally {await rm(directory,{recursive:true,force:true});}
}
test('T05 sends two turns and c3 once, saves response and timing, then skips repeats',()=>temporary(async outputDir=>{
  let calls=0;
  const request=async(url,init)=>{
    calls++;
    assert.ok(url.includes(MODEL));
    const data=JSON.parse(JSON.parse(init.body).contents[0].parts[0].text);
    assert.equal(data.transcript.length,2);
    assert.deepEqual(data.criteria.map(c=>c.key),['c3']);
    assert.equal(data.criteria[0].allowNa,true);
    const output={review:{requests:[{turnIndex:0,answerTurnIndexes:[1],status:'answered',summary:'Публичные тарифы'}],issues:[]},
      results:[{criterion_id:'c3',na_assessment:{condition_met:true,reason:'Публичная информация не требует проверки личности.'},
        checks:[],violations:[],levels:[],explanation:'Общий вопрос о тарифах.',evidence:[{turnIndex:0,quote:data.transcript[0].text}],
        checked_range:{start:0,end:1},omission:false,limitations:[]}]};
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]});
  };
  const first=await runT05({outputDir,key:'fake-key',request,log:()=>{}});
  assert.equal(first.status,'pass');
  await runT05({outputDir,request,log:()=>{}});
  assert.equal(calls,1);
  const saved=JSON.parse(await readFile(path.join(outputDir,'T05.json')));
  const manifest=JSON.parse(await readFile(path.join(outputDir,'.run','manifest.json')));
  assert.equal(manifest.evaluator_sha256,EVALUATOR_SHA256);
  assert.equal(saved.results[0].na,true);
  assert.ok((await readFile(path.join(outputDir,'.run','provider-response.json'),'utf8')).includes('condition_met'));
  const logs=await readFile(path.join(outputDir,'.run','diagnostics.log'),'utf8');
  assert.ok(logs.includes('provider_headers'));
  assert.ok(!logs.includes('fake-key'));
}));
test('T05 saves an upstream error and never retries it',()=>temporary(async outputDir=>{
  let calls=0;
  const request=async()=>{calls++;return Response.json({error:{status:'UNAVAILABLE'}},{status:503});};
  assert.equal((await runT05({outputDir,key:'fake',request,log:()=>{}})).status,'error');
  await runT05({outputDir,request,log:()=>{}});
  assert.equal(calls,1);
}));
