import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, rm, stat, symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {recordingRequest, saveProviderArtifact} from './provider-artifacts.mjs';

async function temporary(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cqa-diagnostics-'));
  try {await run(directory);} finally {await rm(directory, {recursive:true, force:true});}
}

test('private provider errors retain diagnosis, redact keys and cannot overwrite another chat', () => temporary(async outputDir => {
  await mkdir(path.join(outputDir, '.run'));
  const key = 'fake-key/with?encoding';
  const payload = JSON.stringify({error:{message:'Invalid field responseJsonSchema: '+key+' '+encodeURIComponent(key)}});
  saveProviderArtifact(outputDir, {ok:false}, payload, key, 'chat-one');
  saveProviderArtifact(outputDir, {ok:false}, '{"error":"second chat"}', key, 'chat-two');
  const file = path.join(outputDir, '.run', 'provider-error-chat-one.json');
  const saved = await readFile(file, 'utf8');
  assert.ok(saved.includes('responseJsonSchema'));
  assert.ok(!saved.includes(key));
  assert.ok(!saved.includes(encodeURIComponent(key)));
  assert.throws(() => saveProviderArtifact(outputDir, {ok:false}, 'replacement', key, 'chat-one'), {code:'EEXIST'});
  assert.equal(await readFile(file, 'utf8'), saved);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
}));

test('a local artifact failure preserves the actual provider response', () => temporary(async outputDir => {
  const warnings = [];
  const request = recordingRequest({outputDir, warn: message => warnings.push(message),
    request: async () => new Response('provider detail', {status: 400})});
  const response = await request('offline');
  assert.equal(response.status, 400);
  assert.equal(await response.text(), 'provider detail');
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes('provider detail'));
}));

test('the CLI preserves provider failures and replays completed archives offline', () => temporary(async root => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  for (const relative of [
    'ai/gemini.mjs', 'ai/http.mjs', 'ai/config/check-policies.v1.json', 'ai/config/na-policies.v1.json',
    'ai/evaluation/recheck-three.mjs', 'ai/evaluation/run-once.mjs', 'ai/evaluation/provider-artifacts.mjs', 'ai/evaluation/cli.mjs',
    'ai/evaluation/compare.py', 'ai/evaluation/dev-12.manual.v1.json', 'data/dev.json'
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), {recursive:true});
    await copyFile(path.join(repo, relative), target);
  }
  const labels = JSON.parse(await readFile(path.join(root, 'ai/evaluation/dev-12.manual.v1.json')));
  const expected = labels.conversations.find(c => c.conversation_id === 'p1-ru-025');
  const baseline = path.join(root, 'ai/evaluation/predictions');
  await mkdir(baseline);
  await writeFile(path.join(baseline, 'p1-ru-025.json'), JSON.stringify({conversation_id:'p1-ru-025',
    checklist_version:1, results:expected.results.map(({review,...row}) => row)}));
  const key = 'fake-api-key-for-offline-test';
  const preload = path.join(root, 'fake-provider.mjs');
  await writeFile(preload, `import {appendFileSync} from 'node:fs';
globalThis.fetch = async () => {
  appendFileSync(${JSON.stringify(path.join(root, 'calls'))}, 'one\\n');
  return Response.json({error:{status:'INVALID_ARGUMENT',message:'Invalid responseJsonSchema '+process.env.GEMINI_API_KEY}},{status:400});
};`);
  let entry = path.join(root, 'ai/evaluation/recheck-three.mjs');
  if (process.platform !== 'win32') {
    const alias = path.join(root, 'launch-recheck.mjs');
    await symlink(entry, alias);
    entry = alias;
  }
  const args = ['--import',preload,entry,
    '--single-ru025','--run-name','offline-error'];
  const env = {...process.env, GEMINI_API_KEY:key};
  delete env.NODE_TEST_CONTEXT;
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, args, {cwd:root, encoding:'utf8', env});
    assert.equal(result.status, 1, JSON.stringify({stdout:result.stdout,stderr:result.stderr,execPath:process.execPath}));
    assert.ok(!result.stdout.includes(key));
    assert.ok(!result.stderr.includes(key));
  }
  assert.equal(await readFile(path.join(root,'calls'),'utf8'), 'one\n');
  const output = path.join(root,'ai/evaluation/predictions-offline-error');
  const saved = JSON.parse(await readFile(path.join(output,'p1-ru-025.json')));
  assert.equal(saved.error.code, 'GEMINI_REQUEST_REJECTED');
  const error = await readFile(path.join(output,'.run/provider-error.json'),'utf8');
  assert.ok(error.includes('Invalid responseJsonSchema'));
  assert.ok(!error.includes(key));
  const report = JSON.parse(await readFile(path.join(root,'ai/evaluation/report-offline-error.json')));
  assert.ok(report.details.every(d => d.status === 'unavailable'));

  const manifestFile = path.join(output,'.run/manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile));
  manifest.prompt_version = '2.3.0';
  const oldManifest = JSON.stringify(manifest);
  await writeFile(manifestFile, oldManifest);
  const reportPath = path.join(root,'ai/evaluation/report-offline-error.json');
  await writeFile(reportPath, 'archived report');
  const replay = (...flags) => spawnSync(process.execPath,[...args,...flags],
    {cwd:root,encoding:'utf8',env:{...env,GEMINI_API_KEY:''}});
  const archivedError = replay();
  assert.equal(archivedError.status,1);
  assert.match(archivedError.stdout,/Архив: промпт 2\.3\.0/);
  assert.match(archivedError.stdout,/GEMINI_REQUEST_REJECTED/);
  const savedFile = path.join(output,'p1-ru-025.json');
  const full = {...JSON.parse(await readFile(path.join(baseline,'p1-ru-025.json'))), checklist_id:'dev-manual-benchmark'};
  const oldAnswer = JSON.stringify(full);
  await writeFile(savedFile,oldAnswer);
  assert.equal(replay('--dry-run').status,0);
  const archivedSuccess = replay();
  assert.equal(archivedSuccess.status,0,archivedSuccess.stderr);
  assert.match(archivedSuccess.stdout,/p1-ru-025 \/ 04/);
  assert.equal(await readFile(savedFile,'utf8'),oldAnswer);
  await writeFile(savedFile,JSON.stringify({...full,results:full.results.slice(1)}));
  assert.match(replay().stderr,/неполный результат/);
  await rm(savedFile);
  assert.match(replay('--dry-run').stderr,/Архив неполный/);
  assert.match(replay().stderr,/Архив неполный/);
  assert.equal(await readFile(manifestFile,'utf8'),oldManifest);
  assert.equal(await readFile(reportPath,'utf8'),'archived report');
  await rm(manifestFile);
  const missingArchive = replay('--archive-only');
  assert.equal(missingArchive.status,1);
  assert.match(missingArchive.stderr,/manifest отсутствует/);
  assert.equal(await readFile(path.join(root,'calls'),'utf8'),'one\n');
}));
