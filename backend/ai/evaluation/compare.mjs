import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluateLocal, LOCAL_MODEL, official} from '../local.mjs';

// Usage: node ai/evaluation/compare.mjs <original DEV.json> [results/dev/results.json]
const [, , sourceFile, resultsFile] = process.argv;
if (!sourceFile) throw Error('Передайте путь к исходному DEV JSON и, при наличии, официальному results.json.');
const read = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const reference = read(new URL('./dev-reference.json', import.meta.url));
const records = read(sourceFile).data.records;
const inputs = new Map(records.map(row => [row.conversation_id, row]));
const saved = resultsFile ? read(resultsFile) : null;
const predictions = new Map(saved?.results.map(row => [row.conversation_id, row]));
if (inputs.size !== records.length || (saved && predictions.size !== saved.results.length)) throw Error('Повтор conversation_id.');
const exportKeys = ['contact','discovery','identification','consultation','empathy','dialogue','closure','critical'];
const totals = Object.fromEntries(official.criteria.map(c => [c.key, {criterion:c.name, expected:0, valid:0, matches:0}]));
for (const {id, sha256, expected} of reference.conversations) {
  const record = inputs.get(id);
  if (!record) throw Error('Пропущен исходный диалог ' + id);
  const canonical = record.transcript.map(turn => Object.fromEntries(Object.entries(turn).sort(([a],[b])=>a<b?-1:a>b?1:0)));
  if (createHash('sha256').update(JSON.stringify(canonical)).digest('hex') !== sha256) throw Error('Изменился исходный текст ' + id);
  const transcript = record.transcript.map((turn, turnIndex) => ({...turn, turnIndex}));
  let observed;
  if (saved) {
    const row = predictions.get(id);
    observed = new Map((row?.status === 'ok' ? row.criteria : []).map(c => [c.criterion_id, c.value]));
  } else {
    const evaluated = evaluateLocal({...record, transcript, checklist:official});
    observed = new Map(evaluated.map((r,i) => [exportKeys[i], r.answer]));
  }
  for (const [key, target] of Object.entries(expected)) {
    const observedKey = exportKeys[Number(key)-1];
    const counter = totals[key];
    counter.expected++;
    if (!observed.has(observedKey)) continue;
    counter.valid++;
    counter.matches += Number(target === observed.get(observedKey));
  }
}
console.log(saved?.model?.name ?? LOCAL_MODEL, '· сравнение с черновой разметкой команды на 12 чатах DEV');
console.table(Object.values(totals));
const total = key => Object.values(totals).reduce((n, row) => n + row[key], 0);
console.log('Точные совпадения ' + total('matches') + '/' + total('valid') + ', покрытие ' + total('valid') + '/' + total('expected') + '.');
