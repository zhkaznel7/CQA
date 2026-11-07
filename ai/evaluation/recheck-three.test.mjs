import test from 'node:test';
import assert from 'node:assert/strict';
import {selectThree, IDS, runSelection} from './recheck-three.mjs';
import {planInput} from './run-once.mjs';

test('selects exactly the three requested chats with full official checklist', () => {
  const input = planInput().inputs;
  const selected = selectThree(input);
  assert.deepEqual(selected.map(i=>i.conversation_id), IDS);
  assert.equal(selected.length,3);
  assert.ok(selected.every(i=>i.checklist.criteria.length===8));
  assert.throws(()=>selectThree(input.filter(i=>i.conversation_id!==IDS[0])),/отсутствует/);
});

test('single schema check selects only ru-025 with eight criteria', () => {
  const selected = selectThree(planInput().inputs, true);
  assert.deepEqual(selected.map(i=>i.conversation_id), ['p1-ru-025']);
  assert.equal(selected[0].checklist.criteria.length,8);
});

test('prompt 2.1 recheck uses a new isolated directory and exactly ru-025', () => {
  const selection = runSelection(['--ru025-na-v2-1']);
  assert.deepEqual(selection.ids, ['p1-ru-025']);
  assert.equal(selection.directory, 'predictions-ru025-na-v2-1');
  assert.equal(selection.report, 'report-ru025-na-v2-1.json');
  assert.notEqual(selection.directory, runSelection(['--single-ru025']).directory);
  assert.equal(selectThree(planInput().inputs, selection.single)[0].checklist.criteria.length, 8);
  assert.throws(() => runSelection(['--single-ru025', '--ru025-na-v2-1']), /Параметры/);
});

test('named prompt 2.2 run isolates one authorized attempt from every previous run', () => {
  const selection=runSelection(['--single-ru025','--run-name','ru025-v2-2']);
  assert.deepEqual(selection.ids,['p1-ru-025']);
  assert.equal(selection.directory,'predictions-ru025-v2-2');
  assert.equal(selection.report,'report-ru025-v2-2.json');
  assert.equal(selectThree(planInput().inputs,selection.single)[0].checklist.criteria.length,8);
  assert.notEqual(selection.directory,runSelection(['--single-ru025']).directory);
  assert.throws(()=>runSelection(['--run-name','ru025-v2-2']),/одного чата/);
  assert.throws(()=>runSelection(['--single-ru025','--run-name','../old']),/латинские/);
});
