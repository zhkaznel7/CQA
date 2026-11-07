import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { prisma } from '../src/database/client.js';
import { createChecklistSchema } from '../src/modules/checklists/checklists.schema.js';
import { checklistService } from '../src/modules/checklists/checklists.service.js';

try {
  const payload = createChecklistSchema.parse(JSON.parse(await readFile(new URL('../prisma/seed/official-checklist.json', import.meta.url), 'utf8')));
  const existing = await prisma.checklist.findUnique({ where: { key_version: { key: payload.key, version: 1 } }, include: { criteria: true } });
  if (existing) {
    const actual = createChecklistSchema.parse({
      key: existing.key, name: existing.name, sections: existing.config.sections, instructions: existing.config.instructions,
      criteria: [...existing.criteria].sort((a, b) => a.config.position - b.config.position).map(({ key, name, config }) => {
        const { schemaVersion, position, ...fields } = config;
        return { key, name, ...fields };
      }),
    });
    if (!isDeepStrictEqual(actual, payload)) throw new Error('Existing initial version differs from the PDF configuration');
    console.log('Official checklist v1 already exists; unchanged.');
  } else {
    await checklistService(prisma).create(payload);
    console.log('Official checklist v1 created (8 criteria, scored weight 100, unscored violation flag).');
  }
} catch {
  console.error('Official checklist seed failed. Check migrations and existing version; nothing was overwritten.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
