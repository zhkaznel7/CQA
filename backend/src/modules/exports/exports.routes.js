import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/api-error.js';
import { parse } from '../../middleware/validate.js';
import { exportGroupId, groupIdSchema } from '../conversations/groups.js';
import { createOfficialResults } from './official-results.js';
import { readExportEvaluations, readFailures } from './selection.js';
import { exportModel } from './model.js';

const query = z.object({
  group_id: groupIdSchema,
  checklistId: z.uuid(),
  team: z.string().trim().min(1).max(200),
}).strict();

export function exportsRouter(database) {
  const router = Router();
  router.get('/:dataset', async (req, res) => {
    const dataset = parse(z.enum(['dev', 'prod']), req.params.dataset);
    const { group_id: groupId, checklistId, team } = parse(query, req.query);
    try { exportGroupId({}, groupId, dataset); }
    catch { throw new ApiError(400, 'INVALID_GROUP', 'Выберите группу, соответствующую набору'); }
    const expectedCount = dataset === 'dev' ? 65 : 10;
    const file = await database.$transaction(async tx => {
      const manifest = await tx.conversation.findMany({ where: { groupId }, orderBy: { externalId: 'asc' } });
      if (manifest.length !== expectedCount) throw new ApiError(422, 'DATASET_COUNT', `В группе должно быть ${expectedCount} диалогов, найдено ${manifest.length}`);
      const checklist = await tx.checklist.findUniqueOrThrow({ where: { id: checklistId }, include: { criteria: true } });
      const evaluations = await readExportEvaluations(tx, checklistId, groupId, manifest);
      const failures = await readFailures(tx, checklistId, manifest);
      const model = exportModel(evaluations);
      try {
        return createOfficialResults({ teamName: team, model, manifest, evaluations, checklist, dataset, groupId, expectedCount, failures });
      } catch {
        throw new ApiError(422, 'DATASET_INCOMPATIBLE', 'Набор или чек-лист не соответствует формату для сдачи');
      }
    }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
    res.attachment('results.json').json(file);
  });
  return router;
}
