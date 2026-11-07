import { ApiError } from '../../middleware/api-error.js';
import { conversationRecord } from './conversations.schema.js';

export function conversationService(database, loadConversations, maxRecords = 500) {
  return {
    async list({ page, pageSize, language, channel }) {
      const where = { ...(language ? { language } : {}), ...(channel ? { channel } : {}) };
      const [total, data] = await database.$transaction([
        database.conversation.count({ where }),
        database.conversation.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, externalId: true, language: true, channel: true, audioUrl: true, createdAt: true } }),
      ], { isolationLevel: 'RepeatableRead' });
      return { data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
    },
    async get(id) {
      const data = await database.conversation.findUnique({ where: { id } });
      if (!data) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
      return data;
    },
    async import() {
      const records = await loadConversations();
      if (!Array.isArray(records) || records.length > maxRecords) {
        throw new ApiError(502, 'UPSTREAM_INVALID_DATA', 'Import source returned invalid data');
      }
      const seen = new Set();
      const valid = [];
      const rejected = [];
      let duplicates = 0;
      records.forEach((record, index) => {
        const result = conversationRecord.safeParse(record);
        if (!result.success) {
          rejected.push({ index, code: 'INVALID_RECORD', paths: result.error.issues.map((issue) => issue.path.join('.')) });
          return;
        }
        if (seen.has(result.data.externalId)) { duplicates++; return; }
        seen.add(result.data.externalId);
        valid.push({ ...result.data, audioUrl: result.data.audioUrl ?? null,
          transcript: result.data.transcript.map((item, turnIndex) => ({ ...item, turnIndex })) });
      });
      // ON CONFLICT DO NOTHING is safe under concurrent imports and never overwrites history.
      const imported = valid.length ? (await database.conversation.createMany({ data: valid, skipDuplicates: true })).count : 0;
      return { received: records.length, imported, duplicates: duplicates + valid.length - imported, invalid: rejected.length, rejected };
    },
  };
}
