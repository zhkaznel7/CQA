import { z } from 'zod';
import { createChecklistSchema } from '../checklists/checklists.schema.js';
import { ScoringError } from './scoring-error.js';

const identity = z.object({ id: z.uuid().optional(), version: z.number().int().positive() });

const answerSchema = z.object({
  criterionKey: z.string().min(1).max(100),
  isNa: z.boolean().default(false),
  value: z.union([z.boolean(), z.number().finite().nonnegative()]).optional(),
  naConditionMet: z.boolean().optional(),
  naReason: z.string().min(1).max(5000).refine((value) => value.trim().length > 0).optional(),
}).strict().superRefine((answer, context) => {
  if (answer.isNa) {
    if (answer.value !== undefined) context.addIssue({ code: 'custom', path: ['value'], message: 'N/A cannot have a value' });
    if (answer.naConditionMet !== true || answer.naReason === undefined) {
      context.addIssue({ code: 'custom', path: ['naConditionMet'], message: 'N/A requires a confirmed condition and reason' });
    }
  } else {
    if (answer.value === undefined) context.addIssue({ code: 'custom', path: ['value'], message: 'Answer requires a value' });
    if (answer.naConditionMet !== undefined || answer.naReason !== undefined) {
      context.addIssue({ code: 'custom', path: ['isNa'], message: 'Applicability information requires N/A' });
    }
  }
});

function validated(schema, value, code) {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ScoringError(code, 'Invalid scoring input', result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })));
  }
  return result.data;
}

/** Accepts a checklist API detail, or a Prisma row including criteria. No database access. */
export function parseChecklist(input) {
  const header = validated(identity, input, 'INVALID_CHECKLIST');
  if (!Array.isArray(input.criteria)) throw new ScoringError('INVALID_CHECKLIST', 'Checklist criteria are required');
  const rows = input.criteria.map((criterion, index) => ({ criterion, index }));
  // Prisma relations have no implicit order. Use persisted positions without mutating the row.
  rows.sort((a, b) => (a.criterion?.config?.position ?? a.criterion?.position ?? a.index)
    - (b.criterion?.config?.position ?? b.criterion?.position ?? b.index));
  const payload = {
    key: input.key, name: input.name,
    sections: input.sections ?? input.config?.sections,
    instructions: input.instructions ?? input.config?.instructions,
    criteria: rows.map(({ criterion }) => {
      if (!criterion || typeof criterion !== 'object') return criterion;
      const config = criterion.type === undefined ? criterion.config ?? {} : criterion;
      return {
        key: criterion.key, name: criterion.name, description: config.description,
        type: config.type, weight: config.weight, scaleSteps: config.scaleSteps,
        allowNa: config.allowNa, naCondition: config.naCondition, sectionKey: config.sectionKey,
        applicabilityRule: config.applicabilityRule,
      };
    }),
  };
  const checklist = validated(createChecklistSchema, payload, 'INVALID_CHECKLIST');
  rows.forEach(({ criterion }, index) => {
    if (criterion.maxPoints === undefined) return;
    const config = checklist.criteria[index];
    const expected = config.type === 'flag' ? 0 : config.type === 'boolean' ? 1 : Math.max(...config.scaleSteps.map((step) => step.value));
    if (Number(criterion.maxPoints) !== expected) {
      throw new ScoringError('INVALID_CHECKLIST', 'Stored maximum conflicts with criterion definition');
    }
  });
  return { ...checklist, ...header };
}

export function parseAnswers(input, checklist) {
  const answers = validated(z.array(answerSchema).max(100), input, 'INVALID_ANSWERS');
  const criteria = new Map(checklist.criteria.map((criterion) => [criterion.key, criterion]));
  const byKey = new Map();
  for (const answer of answers) {
    const criterion = criteria.get(answer.criterionKey);
    if (!criterion) throw new ScoringError('UNKNOWN_CRITERION', 'Answer references an unknown criterion');
    if (byKey.has(answer.criterionKey)) throw new ScoringError('DUPLICATE_ANSWER', 'Criterion has more than one answer');
    if (answer.isNa) {
      if (!criterion.allowNa || criterion.type === 'flag') throw new ScoringError('NA_NOT_ALLOWED', 'Criterion does not allow N/A');
    } else if (criterion.type === 'scale') {
      if (typeof answer.value !== 'number' || !criterion.scaleSteps.some((step) => step.value === answer.value)) {
        throw new ScoringError('INVALID_SCALE_VALUE', 'Answer is not an allowed scale step');
      }
    } else if (typeof answer.value !== 'boolean') {
      throw new ScoringError('INVALID_BOOLEAN_VALUE', 'Boolean and flag answers must be true or false');
    }
    byKey.set(answer.criterionKey, answer);
  }
  if (byKey.size !== criteria.size) {
    throw new ScoringError('INCOMPLETE_ANSWERS', 'Every criterion, including flags, requires an answer',
      checklist.criteria.filter((criterion) => !byKey.has(criterion.key)).map((criterion) => ({ criterionKey: criterion.key })));
  }
  return byKey;
}
