import test from 'node:test';
import assert from 'node:assert/strict';
import {selectThree, IDS} from './recheck-three.mjs';
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
