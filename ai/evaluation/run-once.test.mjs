import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runBatch} from './run-once.mjs';

const inputs = ['one', 'two'].map(conversation_id => ({conversation_id, checklist:{id:'test',version:1}}));
const identity = {model:'fake', conversation_ids:['one','two']};
async function temporary(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(),'cqa-once-'));
  try { await run(directory); } finally { await rm(directory,{recursive:true,force:true}); }
}
test('one call per conversation; saved success AND error never retried', () => temporary(async outputDir => {
  let calls=0;
  const options = {inputs,outputDir,identity,log:()=>{},evaluate:async input => {
    calls++;
    if (input.conversation_id === 'two') throw Object.assign(Error('quota'),{status:503,code:'AI_UNAVAILABLE'});
    return [];
  }};
  assert.equal((await runBatch(options)).called,2);
  assert.equal((await runBatch(options)).called,0);
  assert.equal(calls,2);
  assert.equal(JSON.parse(await readFile(path.join(outputDir,'two.json'))).error.code,'AI_UNAVAILABLE');
}));
test('interrupted marker prevents a second request even if response file is missing', () => temporary(async outputDir => {
  await runBatch({inputs:[],outputDir,identity,evaluate:()=>{}});
  await writeFile(path.join(outputDir,'.run','one.json'),'{}');
  let calls=0;
  const result=await runBatch({inputs:inputs.slice(0,1),outputDir,identity,log:()=>{},evaluate:()=>{calls++;}});
  assert.equal(calls,0);
  assert.equal(result.interrupted,1);
  assert.equal(JSON.parse(await readFile(path.join(outputDir,'one.json'))).error.code,'ATTEMPT_INTERRUPTED');
}));
test('changed run identity rejected before any request', () => temporary(async outputDir => {
  await runBatch({inputs:[],outputDir,identity,evaluate:()=>{}});
  await assert.rejects(runBatch({inputs,outputDir,identity:{...identity,model:'other'},evaluate:()=>assert.fail()}),/manifest/);
}));
test('concurrent lock prevents requests', () => temporary(async outputDir => {
  await mkdir(path.join(outputDir,'.lock'));
  await assert.rejects(runBatch({inputs,outputDir,identity,evaluate:()=>assert.fail()}),/Сбор уже запущен/);
}));
test('twelve saved responses feed the Python comparison without provider calls', () => temporary(async outputDir => {
  const {spawnSync} = await import('node:child_process');
  const {fileURLToPath} = await import('node:url');
  const labels = JSON.parse(await readFile(new URL('./dev-12.manual.v1.json', import.meta.url)));
  const batch = labels.conversations.map(c => ({conversation_id:c.conversation_id,checklist:{id:'test',version:1}}));
  const summary = await runBatch({inputs:batch,outputDir,identity,log:()=>{},evaluate:async input =>
    labels.conversations.find(c=>c.conversation_id===input.conversation_id).results.map(({review,...result})=>result)});
  assert.equal(summary.called,12);
  const reportFile = path.join(outputDir,'report-output');
  const result = spawnSync('python3',[fileURLToPath(new URL('./compare.py',import.meta.url)),
    '--predictions',outputDir,'--report',reportFile],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report = JSON.parse(await readFile(reportFile));
  assert.equal(report.details.length,96);
  assert.ok(report.details.every(r=>r.status==='match'));
}));
