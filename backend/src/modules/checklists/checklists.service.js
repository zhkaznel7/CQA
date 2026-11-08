import { ApiError } from '../../middleware/api-error.js';

function createData(body, key, version) {
  return {
    key, name: body.name, version,
    config: { schemaVersion: 1, sections: body.sections, instructions: body.instructions },
    criteria: { create: body.criteria.map(({ key: criterionKey, name, ...config }, position) => ({
      key: criterionKey, name,
      maxPoints: config.type === 'flag' ? 0 : config.type === 'boolean' ? 1 : Math.max(...config.scaleSteps.map((step) => step.value)),
      config: { ...config, schemaVersion: 1, position },
    })) },
  };
}

export function serializeChecklist(row) {
  const result = { id: row.id, key: row.key, name: row.name, version: row.version,
    createdAt: row.createdAt, sections: row.config.sections ?? [], instructions: row.config.instructions ?? [], config: row.config };
  if (row.criteria) result.criteria = [...row.criteria]
    .sort((a, b) => (a.config.position ?? 0) - (b.config.position ?? 0) || a.key.localeCompare(b.key))
    .map((criterion) => ({ ...criterion.config, id: criterion.id, key: criterion.key, name: criterion.name, maxPoints: Number(criterion.maxPoints) }));
  return result;
}

export function checklistService(database) {
  return {
    async list({ page, pageSize, key }) {
      const where = key ? { key } : {};
      const [total, rows] = await database.$transaction([
        database.checklist.count({ where }),
        database.checklist.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      ], { isolationLevel: 'RepeatableRead' });
      return { data: rows.map(serializeChecklist), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
    },
    async get(id) {
      const row = await database.checklist.findUnique({ where: { id }, include: { criteria: true } });
      if (!row) throw new ApiError(404, 'CHECKLIST_NOT_FOUND', 'Checklist not found');
      return serializeChecklist(row);
    },
    async create(body) {
      const row = await database.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${body.key}, 0))::text`;
        if (await tx.checklist.findFirst({ where: { key: body.key } })) {
          throw new ApiError(409, 'CHECKLIST_EXISTS', 'Checklist key already exists; create a new version');
        }
        return tx.checklist.create({ data: createData(body, body.key, 1), include: { criteria: true } });
      });
      return serializeChecklist(row);
    },
    async version(id, body) {
      const row = await database.$transaction(async (tx) => {
        const previous = await tx.checklist.findUnique({ where: { id } });
        if (!previous) throw new ApiError(404, 'CHECKLIST_NOT_FOUND', 'Checklist not found');
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${previous.key}, 0))::text`;
        const latest = await tx.checklist.findFirst({ where: { key: previous.key }, orderBy: { version: 'desc' } });
        if (latest.id !== id) throw new ApiError(409, 'STALE_CHECKLIST_VERSION', 'Create a version from the latest checklist version');
        return tx.checklist.create({ data: createData(body, previous.key, latest.version + 1), include: { criteria: true } });
      });
      return serializeChecklist(row);
    },
  };
}
