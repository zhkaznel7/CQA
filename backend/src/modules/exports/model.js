import { ApiError } from '../../middleware/api-error.js';

export function exportModel(evaluations, declared) {
  const completed = evaluations.filter(row => row.status === 'COMPLETED');
  if (completed.some(row => row.provider !== 'ai' || !row.model?.name || !row.model?.mode)) {
    throw new ApiError(422, 'MODEL_UNKNOWN', 'У одной из оценок отсутствуют данные о модели');
  }
  if (!completed.length) {
    if (declared?.name && declared?.mode) return declared;
    return process.env.AI_PROVIDER === 'gemini'
      ? { name: process.env.GEMINI_MODEL?.trim() || 'Gemini (model not configured)', mode: 'external_api' }
      : { name: 'CQA rules-v1', mode: 'local' };
  }
  const names = [...new Set(completed.map(row => row.model.name))].sort();
  const modes = new Set(completed.map(row => row.model.mode));
  const model = { name: names.join(', '), mode: modes.size === 1 ? completed[0].model.mode : 'hybrid' };
  if (declared && (model.name !== declared.name || model.mode !== declared.mode)) {
    throw new ApiError(422, 'MODEL_MISMATCH', 'Указанная модель отличается от сохранённой в оценках');
  }
  return model;
}
