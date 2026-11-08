import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './database/client.js';
import { ensureOfficialChecklist } from './modules/checklists/official-checklist.js';
import { conversationService } from './modules/conversations/conversations.service.js';
import { createConversationSource } from './modules/conversations/organizer-client.js';

let server;
let stopping = false;

async function shutdown(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: closing HTTP server and database pool.`);
  const timeout = setTimeout(() => {
    console.error('HTTP shutdown timed out');
    process.exit(1);
  }, 10000);
  timeout.unref();
  try {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    await prisma.$disconnect();
    process.exitCode = exitCode;
  } catch {
    console.error('Shutdown failed');
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
  }
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  await ensureOfficialChecklist(prisma);
  if (env.IMPORT_SOURCE === 'mock') {
    await conversationService(prisma, createConversationSource(env)).import('DEMO');
  }
  if (!stopping) {
    server = app.listen(env.PORT, env.HOST, () => {
      console.log(`CQA backend listening on http://${env.HOST}:${env.PORT}`);
    });
    server.on('error', (error) => {
      console.error('HTTP server error:', error.code ?? 'UNKNOWN');
      void shutdown('HTTP server error', 1);
    });
  }
} catch {
  // Do not log connection strings, credentials or driver error details.
  console.error('Database connection failed. Check DATABASE_URL and PostgreSQL availability.');
  await shutdown('Startup failure', 1);
}
