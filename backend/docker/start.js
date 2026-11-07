import { spawn } from 'node:child_process';
import { databaseUrl } from '../src/config/database-url.js';

// Encode credentials here so passwords containing @, :, / or $ are safe in URLs.
const url = databaseUrl();
if (!url) throw new Error('Database environment is missing');
process.env.DATABASE_URL = url;
delete process.env.POSTGRES_PASSWORD;

const migration = spawn(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});

const forwardSignals = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => migration.kill(signal)]));
for (const [signal, handler] of forwardSignals) process.once(signal, handler);

migration.once('error', () => {
  console.error('Could not start database migrations');
  process.exitCode = 1;
});
migration.once('exit', async (code, signal) => {
  for (const [name, handler] of forwardSignals) process.removeListener(name, handler);
  if (code !== 0 || signal) {
    console.error('Database migrations did not finish successfully');
    process.exitCode = code || 1;
    return;
  }
  await import('../src/server.js');
});
