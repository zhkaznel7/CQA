import { z } from 'zod';

export const evaluationRequest = z.object({ conversationId: z.uuid(), checklistId: z.uuid() }).strict();

const evidence = z.object({ turnIndex: z.number().int().nonnegative(), quote: z.string().min(1).max(100000).refine((value) => value.trim().length > 0) }).strict();
const range = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict();
const result = z.object({
  criterion_id: z.string().min(1).max(100),
  answer: z.union([z.boolean(), z.number().finite().nonnegative(), z.null()]),
  na: z.boolean(), na_reason: z.string().min(1).max(5000).nullable(),
  explanation: z.string().min(1).max(10000).refine((value) => value.trim().length > 0),
  evidence: z.array(evidence).max(100), checked_range: range.nullable(),
}).strict();

export const aiResponseSchema = z.object({
  conversation_id: z.uuid(), checklist_id: z.uuid(), checklist_version: z.number().int().positive(),
  results: z.array(result).min(1).max(100),
}).strict();
