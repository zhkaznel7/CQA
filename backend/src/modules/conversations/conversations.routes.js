import { sendConversationAudio } from './conversation-audio.js';
import { Router } from 'express';
import { parse } from '../../middleware/validate.js';
import { conversationQuery, idParams, importRequest, importQuery } from './conversations.schema.js';
import { conversationService } from './conversations.service.js';
import { groupIdSchema } from './groups.js';
import { organizerRecords } from './organizer-payload.js';
import { ApiError } from '../../middleware/api-error.js';

export function conversationsRouter(database, loadConversations, maxRecords) {
  const router = Router();
  const service = conversationService(database, loadConversations, maxRecords);
  router.get('/', async (req, res) => res.json(await service.list(parse(conversationQuery, req.query))));
  router.post('/import', async (req, res) => {
    const { group_id } = parse(importRequest, req.body === undefined ? {} : req.body);
    parse(importQuery, req.query);
    res.json({ data: await service.import(group_id) });
  });
  router.post('/upload', async (req, res) => {
    if (req.body?.isSuccess !== true || !Array.isArray(req.body?.data?.records)) {
      throw new ApiError(400, 'INVALID_DATASET', 'Ожидается JSON набора организаторов');
    }
    const groupId = parse(groupIdSchema, req.body?.data?.dataset_group_id);
    let records;
    try {
      records = organizerRecords(req.body, maxRecords, groupId);
    } catch (error) {
      if (error instanceof ApiError) throw new ApiError(400, 'INVALID_DATASET', 'Invalid organizer dataset');
      throw error;
    }
    const data = await service.import(groupId, records);
    res.json({ data });
  });
  router.get('/:id/audio', async (req, res) => sendConversationAudio(database, parse(idParams, req.params).id, req, res));
  router.get('/:id', async (req, res) => res.json({ data: await service.get(parse(idParams, req.params).id) }));
  return router;
}
