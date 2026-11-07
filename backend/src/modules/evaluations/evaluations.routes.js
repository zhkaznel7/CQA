import { Router } from 'express';
import { parse } from '../../middleware/validate.js';
import { idParams } from '../conversations/conversations.schema.js';
import { evaluationRequest } from './evaluations.schema.js';
import { evaluationService } from './evaluations.service.js';

export function evaluationsRouter(database, aiClient) {
  const router = Router();
  const service = evaluationService(database, aiClient);
  router.post('/', async (req, res) => {
    const result = await service.create(parse(evaluationRequest, req.body));
    res.status(result.created ? 201 : 200).location(`/api/evaluations/${result.data.id}`).json({ data: result.data, reused: !result.created });
  });
  router.get('/:id', async (req, res) => res.json({ data: await service.get(parse(idParams, req.params).id) }));
  return router;
}
