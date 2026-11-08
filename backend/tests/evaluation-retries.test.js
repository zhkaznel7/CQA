import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {prisma} from '../src/database/client.js';
import {env} from '../src/config/env.js';
import {evaluationService} from '../src/modules/evaluations/evaluations.service.js';
import {checklistService} from '../src/modules/checklists/checklists.service.js';
import {createChecklistSchema} from '../src/modules/checklists/checklists.schema.js';
import {createMockAiClient} from '../src/ai-client/mock-client.js';

test('simultaneous identical evaluations call AI once; failed work can be retried',async()=>{
 assert.match(new URL(env.DATABASE_URL).pathname,/test/i);
 const key='retry-'+randomUUID();
 const body=JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json',import.meta.url)));body.key=key;
 try{
  const checklist=await checklistService(prisma).create(createChecklistSchema.parse(body));
  const conversation=await prisma.conversation.create({data:{externalId:key,channel:'agent chat',language:'EN',transcript:[{turnIndex:0,speaker:'operator',timestamp:'00:00',text:'Synthetic request retry fixture'}]}});
  let calls=0,fail=false;
  const aiClient={source:'mock',transport:'local',async evaluate(request){calls++;await new Promise(resolve=>setTimeout(resolve,30));if(fail)throw new Error('Synthetic provider failure');return createMockAiClient().evaluate(request);}};
  const service=evaluationService(prisma,aiClient),input={conversationId:conversation.id,checklistId:checklist.id};
  const results=await Promise.all([service.create(input),service.create(input)]);
  assert.equal(calls,1,'Duplicate in-flight requests must not invoke the model twice');
  assert.equal(results.filter(r=>r.created).length,1);assert.deepEqual(results[0].data,results[1].data);
  assert.equal(await prisma.evaluation.count({where:input}),1);
  const retry=await prisma.conversation.create({data:{externalId:key+'-failure',channel:'chat',language:'EN',transcript:conversation.transcript}});
  const next={...input,conversationId:retry.id};fail=true;await assert.rejects(service.create(next));
  assert.equal(await prisma.evaluation.count({where:next}),0);fail=false;
  assert.equal((await service.create(next)).created,true);assert.equal(calls,3);
 }finally{await prisma.$disconnect();}
});
