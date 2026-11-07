import { z } from 'zod';

// Formalization of CQA_Student_Guide_Appendix_Results.pdf, all three pages.
export const officialCriterionKeys = ['contact', 'discovery', 'identification', 'consultation', 'empathy', 'dialogue', 'closure', 'critical'];
const text = z.string().min(1).refine(value => value.trim().length > 0);
const bool = z.boolean();
const values = [bool, bool.nullable(), bool.nullable(), z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(20)]).nullable(), bool,
  z.union([z.literal(0), z.literal(4), z.literal(7), z.literal(10)]), bool.nullable(), bool];
const criterion = z.discriminatedUnion('criterion_id', officialCriterionKeys.map((key, index) => z.object({
  criterion_id: z.literal(key), value: values[index], rationale: text,
  evidence_turns: z.array(z.number().int().positive()).min(1).refine(turns => new Set(turns).size === turns.length),
}).strict()));
const devCallCriterion = z.union([criterion, z.object({
  criterion_id:z.literal('contact'),value:z.null(),rationale:text,
  evidence_turns:z.array(z.number().int().positive()).min(1).refine(turns=>new Set(turns).size===turns.length),
}).strict()]);
const ok = z.object({
  conversation_id: text, status: z.literal('ok'), criteria: z.array(criterion).length(8),
  score: z.object({ final_score: z.number().finite().min(0).max(100).multipleOf(0.01), critical_flag: bool }).strict(),
}).strict().superRefine((record, context) => {
  if (new Set(record.criteria.map(c => c.criterion_id)).size !== 8) context.addIssue({code:'custom',message:'Criteria must occur exactly once'});
  if (record.criteria.find(c => c.criterion_id === 'critical')?.value !== record.score.critical_flag) context.addIssue({code:'custom',message:'Critical flag mismatch'});
});
const error = z.object({ conversation_id: text, status: z.literal('error'), criteria: z.array(z.never()).length(0), score: z.null(), error: text }).strict();
export const officialRecordSchema = z.union([ok, error]);
const devCallRecord = z.object({
  conversation_id:text,status:z.literal('ok'),criteria:z.array(devCallCriterion).length(8),
  score:z.object({final_score:z.number().finite().min(0).max(100).multipleOf(0.01),critical_flag:bool}).strict(),
}).strict().superRefine((record,context)=>{
  if(new Set(record.criteria.map(c=>c.criterion_id)).size!==8)context.addIssue({code:'custom',message:'Criteria must occur exactly once'});
  if(record.criteria.find(c=>c.criterion_id==='critical')?.value!==record.score.critical_flag)context.addIssue({code:'custom',message:'Critical flag mismatch'});
});

/** The 2026-11-08 organizer exception is enabled only for Backend-verified IDs. */
export function resultsSchemaFor({dataset,contactNaIds=[]}={}) {
 const allowed=new Set(dataset==='dev'?contactNaIds:[]);
 return z.object({
  schema_version: z.literal('1.0'), team_name: text,
  model: z.object({mode:z.enum(['local','external_api','hybrid']),name:text}).strict(),
  results: z.array(allowed.size?z.union([officialRecordSchema,devCallRecord]):officialRecordSchema),
}).strict().superRefine((file, context) => {
  if (new Set(file.results.map(r => r.conversation_id)).size !== file.results.length) context.addIssue({code:'custom',message:'Duplicate conversation IDs'});
  for(const record of file.results)if(record.status==='ok'&&record.criteria.find(c=>c.criterion_id==='contact')?.value===null&&!allowed.has(record.conversation_id))context.addIssue({code:'custom',message:'Unconfirmed DEV contact N/A'});
});
}
export const officialResultsSchema = resultsSchemaFor();
