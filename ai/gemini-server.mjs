import {startServer} from './http.mjs';
import {evaluateGemini, checkGemini} from './gemini.mjs';

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) throw Error('Задайте GEMINI_API_KEY в терминале запуска.');
const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const options = {key, model, fast: process.env.GEMINI_FAST === '1'};
if (process.argv.includes('--check')) {
  const start = Date.now();
  try {
    await checkGemini(options);
    console.log('OK: ' + model + ' ответила за ' + ((Date.now() - start) / 1000).toFixed(1) + ' с.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (process.argv.includes('--check-fixture')) {
  const {readFile} = await import('node:fs/promises');
  const fixture = JSON.parse(await readFile(new URL('./mock-request.json', import.meta.url), 'utf8'));
  try {
    const results = await evaluateGemini(fixture, options);
    const greeting = results.find(r => r.criterion_id === '01');
    const consultation = results.find(r => r.criterion_id === '04');
    console.log(JSON.stringify([greeting, consultation], null, 2));
    if (greeting?.answer === false && consultation?.checked_range != null) console.log('PASS');
    else { console.error('FAIL: ожидались 01=false и диапазон для 04'); process.exitCode = 1; }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
  startServer('CQA Gemini (' + model + ')', input => evaluateGemini(input, options));
}
