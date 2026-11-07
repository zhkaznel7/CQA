import { groupIdSchema } from '../conversations/groups.js';

/** Select only the requested group even when source IDs overlap across datasets. */
export function readExportEvaluations(database, checklistId, groupId, manifest) {
  groupIdSchema.parse(groupId);
  return database.evaluation.findMany({
    where: { checklistId, conversation: { groupId, externalId: { in: manifest.map(record => record.externalId) } } },
    include: { conversation: true, results: { include: { criterion: { select: { key: true } } } } },
  });
}
