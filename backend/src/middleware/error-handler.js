import { ApiError } from './api-error.js';

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: {
      code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}),
    } });
  }

  const errors = {
    'entity.parse.failed': [400, 'INVALID_JSON', 'Invalid JSON body'],
    'entity.too.large': [413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'],
    'encoding.unsupported': [415, 'UNSUPPORTED_ENCODING', 'Unsupported content encoding'],
    'charset.unsupported': [415, 'UNSUPPORTED_CHARSET', 'Unsupported charset'],
    CORS_ORIGIN_DENIED: [403, 'CORS_ORIGIN_DENIED', 'Origin is not allowed'],
    P2002: [409, 'CONFLICT', 'A record with this identifier or version already exists'],
    P2003: [409, 'REFERENCE_CONFLICT', 'Related record prevents this operation'],
    P2004: [400, 'DATABASE_CONSTRAINT', 'Data violates database constraints'],
    P2025: [404, 'NOT_FOUND', 'Record not found'],
    P2034: [409, 'CONCURRENT_MODIFICATION', 'Concurrent modification; retry the request'],
    P1000: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'],
    P1001: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'],
    P1002: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'],
    P1017: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'],
    P2024: [503, 'DATABASE_UNAVAILABLE', 'Database is unavailable'],
  };
  const [status, code, message] = errors[err.type ?? err.code]
    ?? [500, 'INTERNAL_SERVER_ERROR', 'Internal server error'];

  if (status === 500) console.error('Unhandled request error');
  res.status(status).json({ error: { code, message } });
}
