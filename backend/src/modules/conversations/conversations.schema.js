import { z } from 'zod';

export const idParams = z.object({ id: z.uuid() }).strict();
export const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
export const conversationQuery = z.object({
  ...pagination,
  language: z.enum(['RU', 'KZ', 'EN']).optional(),
  channel: z.string().trim().min(1).max(50).optional(),
}).strict();

const timestamp = z.union([z.string().min(1).max(200), z.number().finite().nonnegative()]);
const turn = z.object({
  turnIndex: z.number().int().nonnegative().optional(),
  speaker: z.string().min(1).max(200).refine((value) => value.trim().length > 0),
  text: z.string().min(1).max(100000).refine((value) => value.trim().length > 0),
  timestamp: timestamp.optional(),
  startMs: timestamp.optional(),
  endMs: timestamp.optional(),
}).passthrough();

export const conversationRecord = z.object({
  externalId: z.string().trim().min(1).max(200),
  language: z.enum(['RU', 'KZ', 'EN']),
  channel: z.string().trim().min(1).max(50),
  audioUrl: z.url({ protocol: /^https?$/ }).nullable().optional(),
  transcript: z.array(turn).min(1).max(10000),
}).strict().superRefine((value, context) => {
  value.transcript.forEach((item, index) => {
    if (item.turnIndex !== undefined && item.turnIndex !== index) {
      context.addIssue({ code: 'custom', path: ['transcript', index, 'turnIndex'], message: 'turnIndex must match original array position' });
    }
  });
});

export const importRequest = z.object({}).strict();
