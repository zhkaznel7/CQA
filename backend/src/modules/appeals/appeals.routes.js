import { Router } from 'express';
import { parse } from '../../middleware/validate.js';
import { idParams } from '../conversations/conversations.schema.js';
import { appealRequest, appealQuery, appealDecision } from './appeals.schema.js';
import { appealService } from './appeals.service.js';

export function appealsRouter(database) {
  const router = Router();
  const service = appealService(database);
  router.post('/', async (req, res) => {
    const data = await service.create(parse(appealRequest, req.body));
    res.status(201).location(`/api/appeals/${data.id}`).json({ data });
  });
  router.get('/', async (req, res) => res.json(await service.list(parse(appealQuery, req.query))));
  router.get('/:id', async (req, res) => res.json({ data: await service.get(parse(idParams, req.params).id) }));
  router.patch('/:id/decision', async (req, res) => res.json({ data: await service.decide(parse(idParams, req.params).id, parse(appealDecision, req.body)) }));
  return router;
}
