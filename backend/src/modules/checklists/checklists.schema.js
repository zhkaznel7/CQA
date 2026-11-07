import { z } from 'zod';
import { pagination } from '../conversations/conversations.schema.js';

const key = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const text = (max) => z.string().min(1).max(max).refine((value) => value.trim().length > 0);
const step = z.object({ value: z.number().finite().min(0).max(1000000).multipleOf(0.0001), label: text(1000) }).strict();

export const criterionSchema = z.object({
  key,
  name: text(200),
  description: text(10000),
  type: z.enum(['boolean', 'scale', 'flag']),
  weight: z.number().finite().min(0).max(100).multipleOf(0.01),
  scaleSteps: z.array(step).max(50).default([]),
  allowNa: z.boolean().default(false),
  naCondition: text(2000).nullable().default(null),
  sectionKey: key,
}).strict().superRefine((value, context) => {
  const invalid = (path, message) => context.addIssue({ code: 'custom', path: [path], message });
  if (value.type === 'flag') {
    if (value.weight !== 0) invalid('weight', 'Flags have no weight');
    if (value.allowNa) invalid('allowNa', 'Violation flags cannot be N/A');
  } else if (value.weight <= 0) invalid('weight', 'Scored criteria need a positive weight');
  if (value.type === 'scale') {
    if (value.scaleSteps.length < 2 || !value.scaleSteps.some((item) => item.value === 0)) invalid('scaleSteps', 'Scale needs at least two steps including zero');
    const differences = value.scaleSteps.slice(1).map((item, index) => item.value - value.scaleSteps[index].value);
    if (!(differences.every((difference) => difference > 0) || differences.every((difference) => difference < 0))) {
      invalid('scaleSteps', 'Scale values must be strictly ascending or descending');
    }
  } else if (value.scaleSteps.length) invalid('scaleSteps', 'Only scale criteria have steps');
  if (value.allowNa && value.naCondition === null) invalid('naCondition', 'N/A requires a condition');
  if (!value.allowNa && value.naCondition !== null) invalid('naCondition', 'N/A is disabled');
});

const body = z.object({
  name: text(200),
  sections: z.array(z.object({ key, name: text(200) }).strict()).min(1).max(30),
  criteria: z.array(criterionSchema).min(1).max(100),
  instructions: z.array(text(5000)).max(40).default([]),
}).strict();

function validateChecklist(value, context) {
  const sectionKeys = value.sections.map((section) => section.key);
  if (new Set(sectionKeys).size !== sectionKeys.length) context.addIssue({ code: 'custom', path: ['sections'], message: 'Duplicate section key' });
  const keys = value.criteria.map((criterion) => criterion.key);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', path: ['criteria'], message: 'Duplicate criterion key' });
  value.criteria.forEach((criterion, index) => {
    if (!sectionKeys.includes(criterion.sectionKey)) context.addIssue({ code: 'custom', path: ['criteria', index, 'sectionKey'], message: 'Unknown section' });
  });
  if (value.criteria.reduce((sum, criterion) => sum + Math.round(criterion.weight * 100), 0) !== 10000) {
    context.addIssue({ code: 'custom', path: ['criteria'], message: 'Scored weights must sum to 100' });
  }
}

export const createChecklistSchema = body.extend({ key }).superRefine(validateChecklist);
export const versionChecklistSchema = body.superRefine(validateChecklist);
export const checklistQuery = z.object({ ...pagination, key: key.optional() }).strict();
