import { groupIdSchema } from '../conversations/groups.js';

export async function readFailures(database, checklistId, manifest) {
  const externalIds = new Map(manifest.map(row => [row.id, row.externalId]));
  const failures = await database.evaluationFailure.findMany({
    where: { checklistId, conversationId: { in: [...externalIds.keys()] } },
  });
  return new Map(failures.map(row => [externalIds.get(row.conversationId), row.message]));
}

/** Select only the requested group even when source IDs overlap across datasets. */
export function readExportEvaluations(database, checklistId, groupId, manifest) {
  groupIdSchema.parse(groupId);
  return database.evaluation.findMany({
    where: { checklistId, deletedAt: null, conversation: { groupId, externalId: { in: manifest.map(record => record.externalId) } } },
    include: { conversation: true, results: { include: { criterion: { select: { key: true } } } } },
  });
}
