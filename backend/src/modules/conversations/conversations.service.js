import { ApiError } from '../../middleware/api-error.js';
import { conversationRecord } from './conversations.schema.js';
import { groupIdSchema } from './groups.js';
import { isDeepStrictEqual } from 'node:util';

const inputChanged = () => new ApiError(409, 'DATASET_CHANGED', 'Данному ID в группе соответствуют разные транскрипты или метаданные');

export function conversationService(database, loadConversations, maxRecords = 500) {
  return {
    async list({ page, pageSize, language, channel, group_id }) {
      const where = { ...(language ? { language } : {}), ...(channel ? { channel } : {}), ...(group_id ? { groupId: group_id } : {}) };
      const [total, data] = await database.$transaction([
        database.conversation.count({ where }),
        database.conversation.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, externalId: true, groupId: true, language: true, channel: true, audioUrl: true, createdAt: true } }),
      ], { isolationLevel: 'RepeatableRead' });
      return { data, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
    },
    async get(id) {
      const data = await database.conversation.findUnique({ where: { id } });
      if (!data) throw new ApiError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
      return data;
    },
    async import(groupId = 'DEV', uploadedRecords) {
      groupIdSchema.parse(groupId);
      const records = uploadedRecords ?? await loadConversations(groupId);
      if (!uploadedRecords && loadConversations.demo) groupId = 'DEMO';
      if (!Array.isArray(records) || records.length > maxRecords) {
        throw new ApiError(502, 'UPSTREAM_INVALID_DATA', 'Import source returned invalid data');
      }
      const byId = new Map();
      const valid = [];
      const rejected = [];
      let duplicates = 0;
      records.forEach((record, index) => {
        const result = conversationRecord.safeParse(record);
        if (!result.success) {
          rejected.push({ index, code: 'INVALID_RECORD', paths: result.error.issues.map((issue) => issue.path.join('.')) });
          return;
        }
        const row = { ...result.data, groupId, audioUrl: result.data.audioUrl ?? null,
          transcript: result.data.transcript.map((item, turnIndex) => ({ ...item, turnIndex })) };
        const previous = byId.get(row.externalId);
        if (previous) {
          if (!isDeepStrictEqual(previous, row)) throw inputChanged();
          duplicates++;
          return;
        }
        byId.set(row.externalId, row);
        valid.push(row);
      });
      if (uploadedRecords && (rejected.length || duplicates)) {
        throw new ApiError(400, 'INVALID_DATASET', 'Проверьте записи в файле и уникальность ID', rejected);
      }
      const imported = valid.length ? await database.$transaction(async tx => {
        const { count } = await tx.conversation.createMany({ data: valid, skipDuplicates: true });
        if (count !== valid.length) {
          const saved = await tx.conversation.findMany({
            where: { groupId, externalId: { in: [...byId.keys()] } },
            select: { groupId: true, externalId: true, language: true, channel: true, audioUrl: true, transcript: true },
          });
          for (const row of saved) {
            if (!isDeepStrictEqual(row, byId.get(row.externalId))) throw inputChanged();
          }
        }
        return count;
      }) : 0;
      return { groupId, received: records.length, imported, duplicates: duplicates + valid.length - imported, invalid: rejected.length, rejected };
    },
  };
}
