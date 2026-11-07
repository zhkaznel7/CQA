import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { prisma } from '../src/database/client.js';
import { createChecklistSchema } from '../src/modules/checklists/checklists.schema.js';
import { checklistService, serializeChecklist } from '../src/modules/checklists/checklists.service.js';

try {
  const amendment = JSON.parse(await readFile(new URL('../prisma/seed/call-na-amendment.json', import.meta.url), 'utf8'));
  const source = await prisma.checklist.findUnique({ where: { key_version: { key: amendment.baseKey, version: amendment.baseVersion } }, include: { criteria: true } });
  if (!source) throw new Error('Seed official version 1 first');
  const detail = serializeChecklist(source);
  const payload = createChecklistSchema.parse({ key: detail.key, name: detail.name,
    sections: detail.sections, instructions: [...detail.instructions, amendment.instruction],
    criteria: detail.criteria.map(({ id, maxPoints, schemaVersion, position, ...criterion }) => criterion.key === amendment.criterionKey
      ? { ...criterion, allowNa: true, naCondition: amendment.naCondition, applicabilityRule: amendment.applicabilityRule } : criterion),
  });
  const existing = await prisma.checklist.findUnique({ where: { key_version: { key: amendment.baseKey, version: amendment.targetVersion } }, include: { criteria: true } });
  if (existing) {
    const stored = serializeChecklist(existing);
    const actual = createChecklistSchema.parse({ key: stored.key, name: stored.name, sections: stored.sections, instructions: stored.instructions,
      criteria: stored.criteria.map(({ id, maxPoints, schemaVersion, position, ...criterion }) => criterion) });
    if (!isDeepStrictEqual(actual, payload)) throw new Error('Existing v2 differs; do not overwrite');
    console.log('Call N/A amendment v2 already exists; unchanged.');
  } else {
    const { key, ...versionBody } = payload;
    await checklistService(prisma).version(source.id, versionBody);
    console.log('Created v2: greeting N/A needs a voice/call channel AND independent recording-start confirmation. V1 unchanged.');
  }
} catch {
  console.error('Call N/A version seed failed. Check official v1, migrations and existing versions; nothing was overwritten.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
