import { parseArgs } from 'node:util';
import { z } from 'zod';
import { prisma } from '../src/database/client.js';
import { serializeChecklist } from '../src/modules/checklists/checklists.service.js';
import { confirmApplicability } from '../src/modules/evaluations/applicability.js';

// Trusted operator CLI. There is deliberately no public confirmation-write endpoint.
try {
  const { values } = parseArgs({ options: {
    conversation: { type: 'string' }, checklist: { type: 'string' }, criterion: { type: 'string' },
    rule: { type: 'string' }, reviewer: { type: 'string' }, reference: { type: 'string' },
  } });
  const args = z.object({ conversation: z.uuid(), checklist: z.uuid(), criterion: z.string().min(1).max(100),
    rule: z.enum(['verified_condition', 'recording_start_missing']), reviewer: z.string().trim().min(1).max(200), reference: z.string().trim().min(1).max(10000),
  }).parse(values);
  const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: args.conversation } });
  const checklist = serializeChecklist(await prisma.checklist.findUniqueOrThrow({ where: { id: args.checklist }, include: { criteria: true } }));
  const criterion = checklist.criteria.find((item) => item.key === args.criterion);
  const data = { conversationId: args.conversation, checklistId: args.checklist, criterionKey: args.criterion,
    rule: args.rule, confirmedBy: args.reviewer, reference: args.reference };
  if (!criterion || !confirmApplicability(criterion, conversation, checklist, [data])) throw new Error('Rule not applicable');
  await prisma.applicabilityConfirmation.create({ data });
  console.log('Independent N/A confirmation saved for this conversation, checklist version and criterion.');
} catch {
  console.error('N/A confirmation failed. Check IDs, applicability rule and whether confirmation already exists.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
