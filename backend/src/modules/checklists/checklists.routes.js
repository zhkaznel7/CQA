import { Router } from 'express';
import { parse } from '../../middleware/validate.js';
import { idParams } from '../conversations/conversations.schema.js';
import { checklistQuery, createChecklistSchema, versionChecklistSchema } from './checklists.schema.js';
import { checklistService } from './checklists.service.js';

export function checklistsRouter(database) {
  const router = Router();
  const service = checklistService(database);
  router.get('/', async (req, res) => res.json(await service.list(parse(checklistQuery, req.query))));
  router.get('/:id', async (req, res) => res.json({ data: await service.get(parse(idParams, req.params).id) }));
  router.post('/', async (req, res) => {
    const data = await service.create(parse(createChecklistSchema, req.body));
    res.status(201).location(`/api/checklists/${data.id}`).json({ data });
  });
  router.put('/:id', async (req, res) => {
    const id = parse(idParams, req.params).id;
    const data = await service.version(id, parse(versionChecklistSchema, req.body));
    res.status(201).location(`/api/checklists/${data.id}`).json({ data });
  });
  return router;
}
