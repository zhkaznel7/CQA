import {parseArgs, isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {readFile, mkdir, open, unlink, rename, access} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prisma} from '../src/database/client.js';
import {env} from '../src/config/env.js';
import {createAiClient} from '../src/ai-client/index.js';
import {organizerRecords} from '../src/modules/conversations/organizer-payload.js';
import {exportGroupId} from '../src/modules/conversations/groups.js';
import {conversationRecord} from '../src/modules/conversations/conversations.schema.js';
import {conversationService} from '../src/modules/conversations/conversations.service.js';
import {evaluationService} from '../src/modules/evaluations/evaluations.service.js';
import {buildAiRequest} from '../src/modules/evaluations/ai-contract.js';
import {serializeChecklist} from '../src/modules/checklists/checklists.service.js';
import {parseChecklist} from '../src/modules/scoring/scoring.schema.js';
import {resultsSchemaFor} from '../src/modules/exports/results.schema.js';

const backendRoot=fileURLToPath(new URL('../',import.meta.url));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exists=async file=>{try{await access(file);return true;}catch{return false;}};
async function save(file,value){const handle=await open(file,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}}
const cleanTurns=turns=>turns.map(({turnIndex,...turn})=>turn);
let lockFile;
try {
  const {values:v}=parseArgs({options:{input:{type:'string'},dataset:{type:'string'},'group-id':{type:'string'},checklist:{type:'string'},database:{type:'string'},team:{type:'string'},'model-name':{type:'string'},'run-dir':{type:'string'},concurrency:{type:'string',default:'2'},'max-attempts':{type:'string'},execute:{type:'boolean',default:false}}});
  if(!v.input||!['dev','prod'].includes(v.dataset)||!v.checklist||!v['run-dir'])throw new Error('Required: --input FILE --dataset dev|prod --checklist UUID --run-dir .tmp/PATH');
  const concurrency=Number(v.concurrency), maxAttempts=Number(v['max-attempts']);
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw new Error('Concurrency must be 1 or 2');
  const payload=JSON.parse(await readFile(v.input,'utf8'));
  const groupId=exportGroupId(payload,v['group-id'],v.dataset);
  const records=organizerRecords(payload,500,groupId).map(record=>conversationRecord.parse(record));
  const expected=v.dataset==='dev'?65:10;
  if(records.length!==expected||new Set(records.map(r=>r.externalId)).size!==expected)throw new Error('Dataset must have exactly 65 DEV or 10 PROD original unique IDs');
  const row=await prisma.checklist.findUniqueOrThrow({where:{id:v.checklist},include:{criteria:true}});
  const checklist=parseChecklist(serializeChecklist(row));
  if(row.key!=='freedom-broker-chat-quality'||row.criteria.length!==8)throw new Error('Select the saved official checklist version');
  const databaseName=decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
  const existingConversations=await prisma.conversation.findMany({where:{groupId,externalId:{in:records.map(r=>r.externalId)}},include:{evaluations:{where:{checklistId:row.id}}}});
  for(const stored of existingConversations){
    const source=records.find(r=>r.externalId===stored.externalId);
    if(source.language!==stored.language||source.channel!==stored.channel||!isDeepStrictEqual(cleanTurns(source.transcript),cleanTurns(stored.transcript)))throw new Error('Stored source differs from manifest; nothing may be overwritten');
    for(const evaluation of stored.evaluations)if(evaluation.status!=='COMPLETED'||evaluation.provider!=='ai')throw new Error('A mock or unfinished evaluation already occupies this pair; do not overwrite it');
  }
  const reused=existingConversations.filter(c=>c.evaluations.length).length;
  const pending=expected-reused;
  console.log(JSON.stringify({mode:v.execute?'execute':'plan-only',database:databaseName,groupId,records:expected,reusedRealEvaluations:reused,pending,concurrency,configuredSource:env.AI_SERVICE_KIND,configuredMode:env.AI_MODE}));
  // Default planning is read-only and never contacts AI, imports, creates locks or exports.
  if(v.execute){
    if(env.AI_MODE!=='http'||env.AI_SERVICE_KIND!=='ai')throw new Error('Execution blocked: Backend must use HTTP and AI_SERVICE_KIND=ai, never mock');
    if(!v.database||v.database!==databaseName)throw new Error('--database must explicitly match the working PostgreSQL database');
    if(!v.team?.trim()||!v['model-name']?.trim()||v['model-name']!==process.env.GEMINI_MODEL)throw new Error('Declare --team and actual --model-name matching GEMINI_MODEL');
    if(!Number.isInteger(maxAttempts)||maxAttempts<0||maxAttempts>expected||maxAttempts<pending)throw new Error('--max-attempts must explicitly authorize pending records, at most dataset size');
    const runDir=resolve(v['run-dir']), inside=relative(resolve(backendRoot,'.tmp'),runDir);
    if(!inside||inside.startsWith('..')||isAbsolute(inside))throw new Error('Run directory must be inside backend/.tmp');
    // A free transport healthcheck: invalid input is rejected before Gemini is called.
    const health=await fetch(new URL('/v1/evaluations',env.AI_BASE_URL),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(5000)});
    if(health.status!==422||(await health.json()).error?.code!=='INVALID_CONVERSATION')throw new Error('Real AI transport healthcheck failed');
    await mkdir(runDir,{recursive:true});
    const identity={groupId,dataset:v.dataset,checklistId:checklist.id,sourceSha256:hash(payload),checklistSha256:hash(checklist),model:v['model-name'],maxAttempts};
    const manifestPath=resolve(runDir,'manifest.json');
    if(await exists(manifestPath)){if(!isDeepStrictEqual(JSON.parse(await readFile(manifestPath,'utf8')),identity))throw new Error('Run manifest differs; do not reuse this directory');}
    else await save(manifestPath,identity);
    const candidateLock=resolve(runDir,'.lock');await save(candidateLock,{pid:process.pid,startedAt:new Date().toISOString()});lockFile=candidateLock;
    const imported=await conversationService(prisma,async()=>records).import(groupId);
    if(imported.invalid)throw new Error('Import rejected source records');
    const conversations=await prisma.conversation.findMany({where:{groupId,externalId:{in:records.map(r=>r.externalId)}},include:{evaluations:{where:{checklistId:row.id}}}});
    const byId=new Map(conversations.map(c=>[c.id,c]));
    const pendingRecords=records.map(r=>conversations.find(c=>c.externalId===r.externalId)).filter(c=>!c.evaluations.length);
    for(const c of pendingRecords)buildAiRequest(c,checklist); // Fail before paid calls for unsupported transcript roles/timestamps.
    let providerStop=false, attempted=0;
    const outcomes=[];
    const fetchObserved=async(...args)=>{
      const response=await fetch(...args);
      if(!response.ok){
        let code;try{const body=await response.clone().json();code=body.error?.code;}catch{}
        if(['GEMINI_REQUEST_REJECTED','AI_UNAVAILABLE'].includes(code)||[401,403,429,503].includes(response.status))providerStop=true;
      }
      return response;
    };
    const client=createAiClient(env,fetchObserved);
    const wrapped={...client,async evaluate(request){const answer=await client.evaluate(request);const c=byId.get(request.conversation_id);await save(resolve(runDir,c.id+'.ai-response.json'),answer);return answer;}};
    const service=evaluationService(prisma,wrapped);
    async function once(conversation){
      const marker=resolve(runDir,conversation.id+'.attempt.json');
      if(await exists(marker)){outcomes.push({conversation_id:conversation.externalId,status:'error',code:'ATTEMPT_ALREADY_STARTED_NO_RETRY'});return false;}
      if(providerStop||attempted>=maxAttempts)return false;
      await save(marker,{conversationId:conversation.id,externalId:conversation.externalId,startedAt:new Date().toISOString()});attempted++;
      let result;
      try{
        const saved=await service.create({conversationId:conversation.id,checklistId:checklist.id});
        // Read through the same API service serializer after persistence.
        const reread=await service.get(saved.data.id);
        if(!isDeepStrictEqual(reread,saved.data)||reread.provider!=='ai')throw new Error('Saved result readback mismatch');
        result={conversation_id:conversation.externalId,status:'ok',evaluationId:saved.data.id,total:saved.data.score.total,reused:!saved.created};
      }catch(error){result={conversation_id:conversation.externalId,status:'error',code:/^[A-Z][A-Z0-9_]{1,80}$/.test(error.code??'')?error.code:'EVALUATION_FAILED',httpStatus:error.status??null,criterionKeys:Array.isArray(error.details)?error.details.map(d=>d.criterionKey).filter(Boolean):[]};}
      await save(resolve(runDir,conversation.id+'.outcome.json'),result);outcomes.push(result);console.log(JSON.stringify(result));return result.status==='ok';
    }
    // The first pending actual dialogue is the one authorized smoke test. No extra probe consumes quota.
    let smokePassed=pendingRecords.length===0;
    if(pendingRecords.length)smokePassed=await once(pendingRecords[0]);
    if(smokePassed&&!providerStop){let next=1;await Promise.all(Array.from({length:concurrency},async()=>{while(!providerStop&&next<pendingRecords.length){const index=next++;await once(pendingRecords[index]);}}));}
    const exportName='results.real.'+Date.now()+'.json';
    const root=await exists(resolve(backendRoot,'../backend/package.json'))?resolve(backendRoot,'..'):backendRoot;
    const target=resolve(root,'results',v.dataset,'results.json'), generated=resolve(root,'results',v.dataset,exportName);
    const child=spawnSync(process.execPath,[resolve(backendRoot,'scripts/export-results.js'),'--dataset',v.dataset,'--group-id',groupId,'--input',resolve(v.input),'--checklist',checklist.id,'--team',v.team,'--model-name',v['model-name'],'--model-mode','external_api','--output',generated],{stdio:'inherit'});
    if(child.status!==0)throw new Error('Official export failed; saved evaluations and logs were preserved');
    const file=JSON.parse(await readFile(generated,'utf8'));
    const whitelist=file.results.filter(r=>r.status==='ok'&&r.criteria.find(c=>c.criterion_id==='contact')?.value===null).map(r=>r.conversation_id);
    resultsSchemaFor({dataset:v.dataset,contactNaIds:whitelist}).parse(file);
    if(await exists(target))await rename(target,resolve(root,'results',v.dataset,'results.before-real.'+Date.now()+'.json'));
    await rename(generated,target);
    const summary={groupId,attempted,smokePassed,providerStopped:providerStop,ok:file.results.filter(r=>r.status==='ok').length,error:file.results.filter(r=>r.status==='error').length,teamNameTemporary:v.team.includes('REPLACE_'),noRetries:true};
    await save(resolve(runDir,'summary.'+Date.now()+'.json'),summary);console.log(JSON.stringify(summary));
    if(!smokePassed||summary.error)process.exitCode=1;
  }
}catch(error){
  // Do not print arbitrary network/provider errors or connection strings.
  console.error(JSON.stringify({code:'BATCH_BLOCKED',message:error instanceof Error&&!/https?:|postgres(?:ql)?:|AIza/.test(error.message)&&error.message.length<300?error.message:'Check private run state and configuration; nothing was retried.'}));process.exitCode=1;
}finally{if(lockFile)await unlink(lockFile).catch(()=>{});await prisma.$disconnect();}
