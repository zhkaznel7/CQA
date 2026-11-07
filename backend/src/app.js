import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import { prisma } from './database/client.js';
import { conversationsRouter } from './modules/conversations/conversations.routes.js';
import { createConversationSource } from './modules/conversations/organizer-client.js';
import { checklistsRouter } from './modules/checklists/checklists.routes.js';

export function createApp({ database = prisma, loadConversations = createConversationSource(env) } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin(requestOrigin, callback) {
      if (!requestOrigin || env.CORS_ORIGINS.includes(requestOrigin)) {
        return callback(null, true);
      }
      const error = new Error('Origin is not allowed');
      error.code = 'CORS_ORIGIN_DENIED';
      callback(error);
    },
  }));
  app.use(rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } },
  }));
  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use('/api/health', healthRouter);
  app.use('/api/conversations', conversationsRouter(database, loadConversations, env.IMPORT_MAX_RECORDS));
  app.use('/api/checklists', checklistsRouter(database));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export const app = createApp();
