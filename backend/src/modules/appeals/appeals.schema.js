import { z } from 'zod';
import { pagination } from '../conversations/conversations.schema.js';

const text = (maximum) => z.string().trim().min(1).max(maximum);
export const appealRequest = z.object({ evaluationId: z.uuid(), criterionId: z.uuid(), comment: text(4000) }).strict();
export const appealQuery = z.object({ ...pagination, status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional() }).strict();

const decisionFields = { reason: text(4000), reviewer: text(200).default('demo-reviewer') };
export const appealDecision = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('CONFIRM'), ...decisionFields }).strict(),
  z.object({
    decision: z.literal('CHANGE'), ...decisionFields,
    value: z.union([z.boolean(), z.number().finite().nonnegative()]).optional(),
    isNa: z.boolean().default(false), naReason: text(5000).optional(),
  }).strict().superRefine((value, context) => {
    if (value.isNa) {
      if (value.value !== undefined || value.naReason === undefined) {
        context.addIssue({ code: 'custom', path: ['isNa'], message: 'N/A requires a reason and no value' });
      }
    } else if (value.value === undefined || value.naReason !== undefined) {
      context.addIssue({ code: 'custom', path: ['value'], message: 'Applicable change requires a value and no N/A reason' });
    }
  }),
]);
