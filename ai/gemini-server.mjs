import {startServer} from './http.mjs';
import {randomUUID} from 'node:crypto';
import {evaluateGemini, checkGemini, PROMPT_VERSION} from './gemini.mjs';

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw Error('Задайте GEMINI_API_KEY в терминале запуска.');
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const options = {key, model, fast: process.env.GEMINI_FAST === '1'};
function tracedOptions(input) {
  const requestId = randomUUID();
  const cid = input?.conversation_id;
  return {...options, onEvent: event => console.error(JSON.stringify({
    timestamp: new Date().toISOString(), service: 'cqa-ai',
    request_id: requestId,
    conversation_id: typeof cid === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(cid) ? cid : null,
    model, prompt_version: PROMPT_VERSION,
    transcript_turns: input?.transcript?.length ?? null,
    criteria_count: input?.checklist?.criteria?.length ?? null,
    ...event
  }))};
}

if (process.argv.includes('--check')) {
  const start = Date.now();
  try {
    await checkGemini(tracedOptions());
    console.log('OK: ' + model + ' ответила за ' + ((Date.now() - start) / 1000).toFixed(1) + ' с.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (process.argv.includes('--check-fixture')) {
  const {readFile} = await import('node:fs/promises');
  const fixture = JSON.parse(await readFile(new URL('./mock-request.json', import.meta.url), 'utf8'));
  try {
    const results = await evaluateGemini(fixture, tracedOptions(fixture));
    const greeting = results.find(r => r.criterion_id === '01');
    const consultation = results.find(r => r.criterion_id === '04');
    console.log(JSON.stringify([greeting, consultation], null, 2));
    if (greeting?.answer === false && consultation?.checked_range != null) console.log('PASS');
    else { console.error('FAIL: ожидались 01=false и диапазон для 04'); process.exitCode = 1; }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
  startServer('CQA Gemini (' + model + ')', input => evaluateGemini(input, tracedOptions(input)));
}
