import official from '../../../prisma/seed/official-checklist.json' with { type: 'json' };
import { createChecklistSchema } from './checklists.schema.js';
import { checklistService } from './checklists.service.js';

export async function ensureOfficialChecklist(database) {
  const payload = createChecklistSchema.parse(official);
  const where = { key_version: { key: payload.key, version: 1 } };
  const existing = await database.checklist.findUnique({ where });
  if (existing) return existing.id;
  try {
    return (await checklistService(database).create(payload)).id;
  } catch (error) {
    if (error.code !== 'CHECKLIST_EXISTS') throw error;
    return (await database.checklist.findUniqueOrThrow({ where })).id;
  }
}
