import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

// Run from any directory. Node 22+ supplies fetch and parseArgs.
const { values } = parseArgs({ options: {
  dataset: { type: 'string' }, group: { type: 'string' }, input: { type: 'string' },
  api: { type: 'string', default: 'http://127.0.0.1:3001/api' },
  team: { type: 'string', default: 'Heroes' }, checklist: { type: 'string' },
} });

async function api(path, body) {
  const response = await fetch(values.api.replace(/\/$/, '') + path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(130000),
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const message = (await response.json().catch(() => ({}))).error;
    throw Error([response.status, message?.code, message?.message].filter(Boolean).join(' '));
  }
  return response.json();
}

async function originalChecklistId() {
  let page = 1;
  while (true) {
    const response = await api('/checklists?key=freedom-broker-chat-quality&pageSize=100&page=' + page);
    const version = response.data.find(c => c.version === 1);
    if (version) return version.id;
    if (page >= response.pagination.totalPages) throw Error('Укажите UUID версии через --checklist.');
    page++;
  }
}

async function submit() {
  if (!['dev', 'prod'].includes(values.dataset)) throw Error('Укажите --dataset dev или --dataset prod.');
  const isDev = values.dataset === 'dev';
  const expected = isDev ? 65 : 10;
  const file = values.input && JSON.parse((await readFile(values.input, 'utf8')).replace(/^\uFEFF/, ''));
  const group = values.group ?? file?.data?.dataset_group_id ?? (isDev ? 'DEV' : null);
  if (!group || (group === 'DEV') !== isDev) throw Error('Укажите group_id организаторов через --group.');
  let sourceIds;
  if (file) {
    if (file.data?.dataset_group_id !== group) throw Error('Группа файла отличается от выбранной.');
    sourceIds = new Set(file.data?.records?.map(row => row.conversation_id));
    if (sourceIds.size !== expected || file.data.records.length !== expected) throw Error('Проверьте число и уникальность conversation_id.');
  }
  const imported = await api(file ? '/conversations/upload' : '/conversations/import', file || { group_id: group });
  if (imported.data.invalid || imported.data.received !== expected) throw Error('Импорт вернул неполный набор.');
  const conversations = await api('/conversations?' + new URLSearchParams({ group_id: group, pageSize: '100' }));
  if (conversations.data.length !== expected || conversations.data.some(c => sourceIds && !sourceIds.has(c.externalId))) {
    throw Error('Список диалогов в базе отличается от выбранного набора.');
  }
  const checklistId = values.checklist ?? await originalChecklistId();
  const failures = new Map();
  for (const [i, c] of conversations.data.entries()) {
    try {
      await api('/evaluations', { conversationId: c.id, checklistId });
    } catch (error) {
      failures.set(c.externalId, error.message);
      console.error(c.externalId, error.message);
    }
    if ((i + 1) % 10 === 0 || i + 1 === expected) console.log(`Обработано ${i + 1} / ${expected}`);
  }
  const query = new URLSearchParams({ group_id: group, team: values.team, checklistId });
  const result = await api('/exports/' + values.dataset + '?' + query);
  const ids = new Set(result.results?.map(row => row.conversation_id));
  if (result.schema_version !== '1.0' || result.results.length !== expected || ids.size !== expected ||
      !conversations.data.every(c => ids.has(c.externalId))) throw Error('Экспорт вернул неожиданные ID или формат.');
  for (const row of result.results) {
    if (row.status === 'error' && failures.has(row.conversation_id)) row.error = failures.get(row.conversation_id);
  }
  const dir = new URL('../results/' + values.dataset + '/', import.meta.url);
  await mkdir(dir, { recursive: true });
  const tmp = new URL(randomUUID() + '.tmp', dir);
  try {
    await writeFile(tmp, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    await rename(tmp, new URL('results.json', dir));
  } finally {
    await rm(tmp, { force: true });
  }
  const errors = result.results.filter(r => r.status === 'error').length;
  console.log(`results/${values.dataset}/results.json — записей ${expected}, ошибок ${errors}.`);
  if (errors) process.exitCode = 2;
}

submit().catch(error => { console.error(error.message); process.exitCode = 1; });
