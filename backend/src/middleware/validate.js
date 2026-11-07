import { ApiError } from './api-error.js';

export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Never include input values (transcripts, tokens or private URLs).
    const details = result.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }));
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data', details);
  }
  return result.data;
}
