import { isDeepStrictEqual } from 'node:util';
import { calculateScore } from '../scoring/scoring.service.js';
import { parseChecklist } from '../scoring/scoring.schema.js';
import { serializeChecklist } from '../checklists/checklists.service.js';
import { officialCriterionKeys, resultsSchemaFor } from './results.schema.js';
import { canonicalChannel } from '../conversations/channels.js';
import { confirmApplicability } from '../evaluations/applicability.js';
import { assertSavedAiSnapshot } from './ai-inputs.js';

export const mockModel = Object.freeze({mode:'local',name:'CQA mock (synthetic; not Gemini)'});
const weights = [10,15,20,20,15,15,5,0];
const types = ['boolean','boolean','boolean','scale','boolean','scale','boolean','flag'];
const failure = (id, message) => ({conversation_id:id,status:'error',criteria:[],score:null,error:message});

/** Read-only export of original model results. Human review never rewrites AI provenance. */
export function createOfficialResults({teamName,model,manifest,evaluations,checklist,expectedCount,allowMock=false,dataset,confirmations=[],groupId}) {
  if (!Array.isArray(manifest) || manifest.length !== expectedCount) throw new Error('Dataset count does not match the expected split size');
  const ids = manifest.map(record => record?.externalId);
  if (ids.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim()) || new Set(ids).size !== ids.length) throw new Error('Dataset IDs must be nonempty, original and unique');
  if(dataset==='prod'&&manifest.some(record=>canonicalChannel(record.channel)!=='agent chat'))throw new Error('PROD must contain only text chats');
  const completed=evaluations.filter(e=>e.status==='COMPLETED');
  if (completed.some(e => e.provider === 'mock') && (!allowMock || !isDeepStrictEqual(model,mockModel))) throw new Error('Mock exports require explicit consent and the synthetic mock label');
  if (completed.some(e => e.provider === 'ai') && allowMock) throw new Error('Do not mix real and synthetic model provenance');
  const parsed = parseChecklist(serializeChecklist(checklist));
  const configs = new Map(parsed.criteria.map(c=>[c.key,c]));
  const officialShape = parsed.criteria.length === 8 && officialCriterionKeys.every((_,i)=>{
    const c=configs.get(String(i+1).padStart(2,'0'));
    return c?.type===types[i] && c.weight===weights[i]
      && (c.type!=='scale' || isDeepStrictEqual([...c.scaleSteps.map(s=>s.value)].sort((a,b)=>a-b),i===3?[0,5,10,15,20]:[0,4,7,10]));
  });
  const byConversation = new Map();
  const externalIds = new Set();
  for(const evaluation of evaluations){
    if(groupId!==undefined && evaluation.conversation.groupId!==groupId) throw new Error('Export contains another dataset group');
    if(externalIds.has(evaluation.conversation.externalId)) throw new Error('Duplicate external ID across export groups');
    externalIds.add(evaluation.conversation.externalId);
    if(evaluation.checklistId!==parsed.id) throw new Error('Export contains another checklist version');
    if(byConversation.has(evaluation.conversationId)) throw new Error('Duplicate evaluation for conversation');
    byConversation.set(evaluation.conversationId,evaluation);
  }
  const byExternal = new Map(evaluations.map(e=>[e.conversation.externalId,e]));
  const contactNaIds=[];
  const results=manifest.map(source=>{
    const id=source.externalId, evaluation=byExternal.get(id);
    if(!evaluation || evaluation.status!=='COMPLETED') return failure(id,'No completed evaluation for the selected checklist version.');
    if(!['mock','ai'].includes(evaluation.provider))return failure(id,'Saved evaluation model provenance is unavailable.');
    if(!officialShape) return failure(id,'Checklist configuration cannot be represented by the official eight-criterion format.');
    try{
      const conversation=evaluation.conversation;
      const clean=turn=>{const {turnIndex,...rest}=turn;return rest;};
      if(conversation.channel!==source.channel || conversation.language!==source.language
        || !isDeepStrictEqual(conversation.transcript.map(clean),source.transcript.map(clean))) throw new Error('source');
      if(evaluation.aiResponse)assertSavedAiSnapshot(evaluation,parsed);
      const rows=new Map(evaluation.results.map(r=>[r.criterion.key,r]));
      if(rows.size!==8 || evaluation.results.length!==8) throw new Error('criteria');
      const contactNa=rows.get('01')?.isNa;
      if(contactNa && (dataset!=='dev' || canonicalChannel(source.channel)!=='voice call'
        || configs.get('01').applicabilityRule?.kind!=='recording_start_missing'
        || !confirmApplicability(configs.get('01'),conversation,parsed,confirmations))) {
        return failure(id,'contact=null is allowed only for a DEV call with independently confirmed missing recording start for this checklist version.');
      }
      const answers=parsed.criteria.map(c=>{const r=rows.get(c.key);return r.isNa
        ?{criterionKey:c.key,isNa:true,naConditionMet:true,naReason:r.naReason}:{criterionKey:c.key,value:r.answer};});
      const score=calculateScore(parsed,answers);
      if(!isDeepStrictEqual(score,evaluation.score)) throw new Error('snapshot');
      const criteria=officialCriterionKeys.map((key,index)=>{
        const r=rows.get(String(index+1).padStart(2,'0'));
        const turns=new Set();
        for(const proof of r.evidence){if(!Number.isInteger(proof.turnIndex)||proof.turnIndex<0||!conversation.transcript[proof.turnIndex]?.text.includes(proof.quote)||!proof.quote?.trim())throw new Error('evidence');turns.add(proof.turnIndex+1);}
        const range=r.checkedRange;
        if(!r.isNa && r.answer===false && types[index]==='boolean' && !range)throw new Error('missing action range');
        if(range){if(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.start>range.end||range.end>=conversation.transcript.length)throw new Error('range');
          if([...turns].some(turn=>turn-1<range.start||turn-1>range.end))throw new Error('evidence range');
          for(let i=range.start;i<=range.end;i++)turns.add(i+1);}
        if(!turns.size)throw new Error('support');
        const rationale=r.isNa && r.naReason.trim()!==r.explanation.trim()?r.naReason+' '+r.explanation:r.explanation;
        return {criterion_id:key,value:r.isNa?null:r.answer,rationale:rationale.trim(),evidence_turns:[...turns].sort((a,b)=>a-b)};
      });
      const record={conversation_id:id,status:'ok',criteria,score:{final_score:evaluation.score.total,critical_flag:evaluation.score.grossError}};
      resultsSchemaFor({dataset,contactNaIds:contactNa?[id]:[]}).parse({schema_version:'1.0',team_name:teamName,model,results:[record]});
      if(contactNa)contactNaIds.push(id);
      return record;
    }catch{return failure(id,'Stored result, transcript, evidence or score is incompatible with official format 1.0; original data was not changed.');}
  });
  return resultsSchemaFor({dataset,contactNaIds}).parse({schema_version:'1.0',team_name:teamName,model,results});
}
