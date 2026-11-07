import {isDeepStrictEqual} from 'node:util';

export function assertSavedAiSnapshot(evaluation,checklist) {
  const raw=evaluation?.aiResponse;
  if(!raw || evaluation.status!=='COMPLETED' || evaluation.checklistId!==checklist.id
    || raw.conversation_id!==evaluation.conversationId || raw.checklist_id!==checklist.id
    || raw.checklist_version!==checklist.version || !Array.isArray(raw.results) || raw.results.length!==8)throw new Error('Stored AI identity or checklist version mismatch');
  const rows=new Map(evaluation.results.map(r=>[r.criterion.key,r]));
  const seen=new Set();
  for(const row of raw.results){
    const saved=rows.get(row.criterion_id);
    if(!saved || seen.has(row.criterion_id) || !isDeepStrictEqual(row.answer,saved.answer) || row.na!==saved.isNa
      || row.explanation!==saved.explanation || row.na_reason!==saved.naReason
      || !isDeepStrictEqual(row.evidence,saved.evidence)
      || !isDeepStrictEqual(row.checked_range,saved.checkedRange))throw new Error('Stored AI response differs from saved criterion results');
    seen.add(row.criterion_id);
  }
}

/** Offline compatibility bridge only. Scores are copied from saved Backend snapshots. */
export function createAiExportInputs({file,evaluations,checklist,dataset}) {
  if(!['dev','prod'].includes(dataset))throw new Error('An explicit dataset is required');
  const byId=new Map();
  for(const evaluation of evaluations){
    if(byId.has(evaluation.conversation.externalId))throw new Error('Duplicate external ID');
    byId.set(evaluation.conversation.externalId,evaluation);
  }
  const responses=[],scores=[],records=[];
  for(const record of file.results){
    const evaluation=byId.get(record.conversation_id);
    if(record.status==='error'){
      responses.push({conversation_id:record.conversation_id,error:{code:'BACKEND_EXPORT_ERROR'}});
      records.push({conversation_id:record.conversation_id,status:'error',reason:record.error});
      continue;
    }
    assertSavedAiSnapshot(evaluation,checklist);
    const raw=evaluation.aiResponse;
    responses.push({...structuredClone(raw),conversation_id:record.conversation_id});
    scores.push({conversation_id:record.conversation_id,checklist_id:checklist.id,
      checklist_version:checklist.version,score:structuredClone(evaluation.score)});
    records.push({conversation_id:record.conversation_id,backend_conversation_id:evaluation.conversationId,
      evaluation_id:evaluation.id,status:'ok'});
  }
  return {responses,scores,manifest:{transfer_version:'1.0',dataset,checklist_id:checklist.id,
    checklist_version:checklist.version,team_name:file.team_name,model:file.model,
    synthetic:evaluations.some(e=>e.provider==='mock'),records}};
}
