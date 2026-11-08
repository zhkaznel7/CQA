import { ApiError } from '../../middleware/api-error.js';

/** Adapt the official guide envelope without changing source IDs, channels or turns. */
export function organizerRecords(payload, maxRecords = 500, expectedGroupId) {
  const official = payload?.isSuccess === true && Array.isArray(payload.data?.records);
  const records = official ? payload.data.records : payload?.conversations;
  if (!Array.isArray(records) || records.length > maxRecords
    || (Object.hasOwn(payload, 'isSuccess') && !official)
    || (official && (!Number.isInteger(payload.data.total_records) || payload.data.total_records !== records.length))) {
    throw new ApiError(502, 'UPSTREAM_INVALID_DATA', 'Import source returned an invalid or incomplete dataset');
  }
  if (official && expectedGroupId !== undefined && payload.data.dataset_group_id !== expectedGroupId) {
    throw new ApiError(502, 'UPSTREAM_GROUP_MISMATCH', 'Import source returned a different dataset group');
  }
  return official ? records.map((record) => record && typeof record === 'object' ? {
    externalId: record.conversation_id, language: record.language, channel: record.channel,
    audioUrl: record.audio_url ?? null, transcript: record.transcript,
  } : record) : records;
}
