import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, open, readFile, rename, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {evaluateGemini, EVALUATOR_SHA256} from '../gemini.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const canonical = value => JSON.stringify(sortKeys(value));
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sortKeys(value[k])]));
  return value;
}
async function saveJson(file, data) {
  const temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify(data, null, 2) + String.fromCharCode(10), {mode: 0o600});
  await rename(temporary, file);
}
export function planInput() {
  const labelFile = path.join(here, 'dev-12.manual.v1.json');
  const labels = JSON.parse(readFileSync(labelFile, 'utf8'));
  const rawSource = readFileSync(path.join(here, '../../data/dev.json'));
  if (hash(rawSource) !== labels.source.sha256) throw Error('DEV изменился относительно разметки.');
  if (hash(canonical(labels.rubric.snapshot)) !== labels.rubric.sha256) throw Error('Хеш рубрики не совпадает.');
  const records = new Map(JSON.parse(rawSource).data.records.map(r => [r.conversation_id, r]));
  if (labels.conversations.length !== 12 || new Set(labels.conversations.map(c => c.conversation_id)).size !== 12) {
    throw Error('Ожидались 12 уникальных размеченных чатов.');
  }
  const inputs = labels.conversations.map(c => {
    const record = records.get(c.conversation_id);
    if (!record || hash(canonical(record.transcript)) !== c.transcript_sha256) throw Error('Изменён транскрипт ' + c.conversation_id);
    return {
      conversation_id: record.conversation_id, channel: record.channel, language: record.language,
      transcript: record.transcript.map((turn, turnIndex) => ({...turn, turnIndex})),
      checklist: {...labels.rubric.snapshot, id: 'dev-manual-benchmark', version: labels.rubric.version}
    };
  });
  return {inputs, labelsHash: hash(readFileSync(labelFile)), sourceHash: hash(rawSource),
    rubricHash: labels.rubric.sha256, evaluatorHash: EVALUATOR_SHA256};
}

// No retries. The durable attempt marker is created BEFORE entering the provider.
export async function runBatch({inputs, outputDir, identity, evaluate, log = console.log, stopOnRequestRejected = false}) {
  await mkdir(outputDir, {recursive: true});
  const lock = path.join(outputDir, '.lock');
  try { await mkdir(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw Error('Сбор уже запущен или осталась .lock после аварии. Убедитесь, что процесс остановлен, прежде чем удалять только .lock.');
    throw error;
  }
  const summary = {called: 0, skipped: 0, interrupted: 0, savedErrors: 0};
  try {
    const state = path.join(outputDir, '.run');
    await mkdir(state, {recursive: true});
    const manifest = path.join(state, 'manifest.json');
    if (existsSync(manifest)) {
      if (canonical(JSON.parse(await readFile(manifest, 'utf8'))) !== canonical(identity)) {
        throw Error('Состав запуска, модель или промпт отличаются от сохранённого manifest. Эта папка принадлежит прежнему запуску.');
      }
    } else {
      if (inputs.some(input => existsSync(path.join(outputDir, input.conversation_id + '.json')))) {
        throw Error('В папке есть ответы без manifest. Выберите пустую папку; чужие результаты не перезаписываются.');
      }
      await saveJson(manifest, identity);
    }
    for (const input of inputs) {
      const cid = input.conversation_id;
      if (!/^[a-zA-Z0-9_-]+$/.test(cid)) throw Error('Недопустимый ID диалога.');
      const resultFile = path.join(outputDir, cid + '.json');
      const attemptFile = path.join(state, cid + '.json');
      if (existsSync(resultFile)) {
        summary.skipped++;
        log('Пропуск сохранённого: ' + cid);
        continue;
      }
      let marker;
      try { marker = await open(attemptFile, 'wx', 0o600); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // The provider might have consumed quota before the process was stopped.
        await saveJson(resultFile, {conversation_id: cid, error: {code: 'ATTEMPT_INTERRUPTED',
          message: 'Попытка была начата, результат не сохранён. Автоматический повтор запрещён.', retryable: false}});
        summary.interrupted++;
        log('Пропуск ранее начатой попытки: ' + cid);
        continue;
      }
      try {
        await marker.writeFile(JSON.stringify({started_at: new Date().toISOString(), input_sha256: hash(canonical(input))}));
        await marker.sync();
      } finally { await marker.close(); }
      summary.called++;
      log('Gemini, одна попытка: ' + cid);
      let response;
      try {
        const results = await evaluate(input);
        response = {conversation_id: cid, checklist_id: input.checklist.id,
          checklist_version: input.checklist.version, results};
      } catch (error) {
        summary.savedErrors++;
        response = {conversation_id: cid, error: {
          code: error.code && error.status ? error.code : 'EVALUATION_FAILED',
          message: error.status ? error.message : 'Не удалось получить результат оценки.',
          retryable: false
        }};
      }
      await saveJson(resultFile, response);
      log('Сохранён: ' + cid + (response.error ? ' (' + response.error.code + ')' : ''));
      if (stopOnRequestRejected && response.error?.code === 'GEMINI_REQUEST_REJECTED') {
        log('Сбор остановлен после отклонения запроса Google; остальные чаты не отправлены.');
        break;
      }
    }
    return summary;
  } finally { await rm(lock, {recursive: true}); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => a !== '--dry-run')) throw Error('Допустимый параметр: --dry-run');
  const {inputs, ...provenance} = planInput();
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const outputDir = path.join(here, 'predictions');
  const identity = {schema_version: 1, ...provenance, model, fast: process.env.GEMINI_FAST === '1',
    conversation_ids: inputs.map(i => i.conversation_id)};
  if (args.includes('--dry-run')) {
    console.log('Без запросов: ' + inputs.length + ' диалогов, модель ' + model + ', папка ' + outputDir);
    for (const input of inputs) {
      const cid = input.conversation_id;
      const status = existsSync(path.join(outputDir, cid + '.json')) ? 'сохранён' :
        existsSync(path.join(outputDir, '.run', cid + '.json')) ? 'ранее начат, повтор запрещён' : 'одна новая попытка';
      console.log(cid + ' — ' + status);
    }
    return;
  }
  // Check comparison prerequisites before spending quota.
  const python = process.env.PYTHON || 'python3';
  if (spawnSync(python, ['--version']).status !== 0) throw Error('Для сравнения нужен Python 3.');
  const key = process.env.GEMINI_API_KEY?.trim();
  const hasPending = inputs.some(i => !existsSync(path.join(outputDir, i.conversation_id + '.json')) &&
    !existsSync(path.join(outputDir, '.run', i.conversation_id + '.json')));
  if (hasPending && !key) throw Error('Задайте GEMINI_API_KEY в этом терминале.');
  const summary = await runBatch({inputs, outputDir, identity,
    evaluate: input => evaluateGemini(input, {key, model, fast: identity.fast})});
  console.log('Сбор завершён:', summary);
  const result = spawnSync(python, [path.join(here, 'compare.py'), '--predictions', outputDir,
    '--report', path.join(here, 'report.json')], {stdio: 'inherit'});
  if (result.status !== 0) throw Error('Сравнение не завершилось. Сохранённые ответы доступны; повторять сбор не требуется.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
