import { Router } from 'express';
import { parse } from '../../middleware/validate.js';
import { conversationQuery, idParams, importRequest } from './conversations.schema.js';
import { conversationService } from './conversations.service.js';

export function conversationsRouter(database, loadConversations, maxRecords) {
  const router = Router();
  const service = conversationService(database, loadConversations, maxRecords);
  router.get('/', async (req, res) => res.json(await service.list(parse(conversationQuery, req.query))));
  router.post('/import', async (req, res) => {
    parse(importRequest, req.body === undefined ? {} : req.body);
    parse(importRequest, req.query);
    res.json({ data: await service.import() });
  });
  router.get('/:id', async (req, res) => res.json({ data: await service.get(parse(idParams, req.params).id) }));
  return router;
}
