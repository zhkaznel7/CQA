import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, appendFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {runBatch} from './run-once.mjs';
import {evaluateGemini, PROMPT_VERSION} from '../gemini.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const MODEL = 'gemini-3.5-flash-lite';
const inputFile = path.join(here, 't05-request.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));

export async function runT05({outputDir, key, request = fetch, log = console.log}) {
  const input = read(inputFile);
  const pending = !existsSync(path.join(outputDir, 'T05.json')) && !existsSync(path.join(outputDir, '.run', 'T05.json'));
  if (pending && !key?.trim()) throw Error('Задайте GEMINI_API_KEY в этом терминале. Запросов ещё не было.');
  const summary = await runBatch({
    inputs: [input], outputDir, log, stopOnRequestRejected: true,
    identity: {schema_version:1, model:MODEL, prompt_version:PROMPT_VERSION,
      input_sha256:hash(readFileSync(inputFile)),
      evaluator_sha256:hash(readFileSync(path.join(here,'../gemini.mjs')))},
    evaluate: data => evaluateGemini(data, {key, model:MODEL,
      request: async (url, init) => {
        const response = await request(url, init);
        return {status:response.status, ok:response.ok, headers:response.headers,
          text:async () => {
            const payload = await response.text();
            // Successful provider output is local only, for offline diagnosis.
            if (response.ok) writeFileSync(path.join(outputDir,'.run','provider-response.json'),payload,{mode:0o600});
            return payload;
          }};
      },
      onEvent: event => appendFileSync(path.join(outputDir,'.run','diagnostics.log'),
        JSON.stringify({timestamp:new Date().toISOString(),conversation_id:'T05',model:MODEL,...event})+String.fromCharCode(10))
    })
  });
  const response = read(path.join(outputDir,'T05.json'));
  const result = response.results?.[0];
  const pass = !response.error && response.results.length === 1 && result.criterion_id === 'c3' &&
    result.answer === null && result.na === true && typeof result.na_reason === 'string' && result.na_reason.trim().length > 0;
  const verification = {test:'T05',model:MODEL,prompt_version:PROMPT_VERSION,
    status:response.error?'error':pass?'pass':'fail',summary,
    expectation:'c3: answer=null, na=true, непустой na_reason'};
  writeFileSync(path.join(outputDir,'.run','verification.json'),JSON.stringify(verification,null,2)+String.fromCharCode(10),{mode:0o600});
  log(JSON.stringify(response,null,2));
  log(verification.status.toUpperCase());
  return verification;
}

async function main() {
  if (process.argv.slice(2).some(a=>a!=='--dry-run')) throw Error('Допустимый параметр: --dry-run');
  const outputDir = path.join(here,'predictions-t05-na-v2-1');
  if (process.argv.includes('--dry-run')) {
    const attempted=existsSync(path.join(outputDir,'T05.json')) || existsSync(path.join(outputDir,'.run','T05.json'));
    console.log(MODEL + ': T05, две реплики, только c3. ' + (attempted?'Начатая попытка будет пропущена.':'Одна новая попытка.'));
    console.log('Результаты: ' + outputDir);
    return;
  }
  const result = await runT05({outputDir,key:process.env.GEMINI_API_KEY});
  if (result.status !== 'pass') process.exitCode=1;
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
