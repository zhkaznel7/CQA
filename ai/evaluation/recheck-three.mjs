import {appendFileSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {planInput, runBatch} from './run-once.mjs';
import {evaluateGemini, PROMPT_VERSION} from '../gemini.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const IDS = ['p1-ru-025', 'p1-en-015', 'p1-en-014'];
export function selectThree(inputs, single = false) {
  const selected = (single ? ['p1-ru-025'] : IDS).map(cid => inputs.find(i => i.conversation_id === cid));
  if (selected.some(i => !i)) throw Error('Один из трёх чатов отсутствует в DEV.');
  return selected;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--dry-run', '--single-ru025'].includes(a))) throw Error('Параметры: --dry-run, --single-ru025');
  const single = args.includes('--single-ru025');
  const ids = single ? ['p1-ru-025'] : IDS;
  const {inputs: allInputs, ...provenance} = planInput();
  const inputs = selectThree(allInputs, single);
  const outputDir = path.join(here, single ? 'predictions-ru025-schema-check' : 'predictions-recheck-v2');
  const baselineDir = path.join(here, 'predictions');
  const model = 'gemini-3.5-flash-lite';
  const identity = {schema_version: 1, ...provenance, model, fast: false,
    prompt_version: PROMPT_VERSION, conversation_ids: ids};
  for (const cid of ids) {
    if (!existsSync(path.join(baselineDir, cid + '.json'))) throw Error('Нет первого результата для ' + cid);
  }
  if (args.includes('--dry-run')) {
    console.log('Без отправки запросов. Модель: ' + model + ', промпт: ' + PROMPT_VERSION);
    console.log('Отдельная папка: ' + outputDir);
    for (const cid of ids) {
      const attempted = existsSync(path.join(outputDir, '.run', cid + '.json'));
      const saved = existsSync(path.join(outputDir, cid + '.json'));
      console.log(cid + ' — ' + (saved || attempted ? 'пропустить начатую попытку' : 'одна новая попытка'));
    }
    return;
  }
  const python = process.env.PYTHON || 'python3';
  if (spawnSync(python, ['--version']).status !== 0) throw Error('Для сравнения нужен Python 3.');
  const key = process.env.GEMINI_API_KEY?.trim();
  const pending = ids.some(cid => !existsSync(path.join(outputDir, cid + '.json')) &&
    !existsSync(path.join(outputDir, '.run', cid + '.json')));
  if (pending && !key) throw Error('Задайте GEMINI_API_KEY в этом терминале. Запросов ещё не было.');
  const summary = await runBatch({inputs, outputDir, identity, stopOnRequestRejected: true, evaluate: input =>
    evaluateGemini(input, {key, model, onEvent: event => {
      appendFileSync(path.join(outputDir, '.run', 'diagnostics.log'),
        JSON.stringify({timestamp: new Date().toISOString(), conversation_id: input.conversation_id, model, ...event}) + String.fromCharCode(10));
    }})});
  console.log('Сбор ' + inputs.length + ' чатов завершён:', summary);
  const result = spawnSync(python, [path.join(here, 'compare.py'),
    '--predictions', outputDir, '--ids', ids.join(','), '--baseline', baselineDir,
    '--report', path.join(here, single ? 'report-ru025-schema-check.json' : 'report-recheck-v2.json')], {stdio: 'inherit'});
  if (result.status !== 0) throw Error('Не удалось завершить сравнение; ответы сохранены, отправлять их повторно не нужно.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
