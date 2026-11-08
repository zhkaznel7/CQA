// Offline check of a saved DEV results.json against the original organizer response.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { canonicalChannel } from '../src/modules/conversations/channels.js';
import { organizerRecords } from '../src/modules/conversations/organizer-payload.js';
import { officialCriterionKeys, resultsSchemaFor } from '../src/modules/exports/results.schema.js';
import { mockModel } from '../src/modules/exports/official-results.js';
import { calculateScore } from '../src/modules/scoring/scoring.service.js';

const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' }, results: { type: 'string' },
    'confirmed-call': { type: 'string', multiple: true, default: [] },
  } });
  if (!values.input || !values.results) throw Error('Required: --input DEV_SOURCE --results RESULTS_JSON');
  const source = json(values.input);
  if (source.isSuccess !== true || source.data?.dataset_group_id !== 'DEV') throw Error('Expected official DEV source');
  const records = organizerRecords(source, 65, 'DEV');
  const byId = new Map(records.map(r => [r.externalId, r]));
  if (records.length !== 65 || byId.size !== 65) throw Error('DEV requires 65 distinct source IDs');

  const confirmed = new Set(values['confirmed-call']);
  for (const id of confirmed) {
    if (canonicalChannel(byId.get(id)?.channel) !== 'voice call') throw Error('Unknown DEV call: ' + id);
  }
  const parsed = resultsSchemaFor({ dataset: 'dev', contactNaIds: confirmed }).safeParse(json(values.results));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw Error(issue.path.join('.') + ' ' + issue.message);
  }
  const file = parsed.data;
  if (file.model.name === mockModel.name) throw Error('Synthetic mock export cannot be submitted');
  if (file.results.length !== 65) throw Error('Expected 65 results, got ' + file.results.length);
  const checklist = { ...json(new URL('../prisma/seed/official-checklist.json', import.meta.url)), version: 1 };
  const amendment = json(new URL('../prisma/seed/call-na-amendment.json', import.meta.url));
  const voiceChecklist = { ...checklist, version: amendment.targetVersion,
    criteria: checklist.criteria.map(c => c.key === amendment.criterionKey
      ? { ...c, allowNa: true, naCondition: amendment.naCondition, applicabilityRule: amendment.applicabilityRule } : c) };
  const errors = [];
  for (const r of file.results) {
    const sourceRecord = byId.get(r.conversation_id);
    if (!sourceRecord) throw Error('Unexpected conversation_id: ' + r.conversation_id);
    if (r.status === 'error') { errors.push(r.conversation_id); continue; }
    const answers = r.criteria.map(c => {
      if (c.evidence_turns.some(n => n > sourceRecord.transcript.length)) {
        throw Error(r.conversation_id + '/' + c.criterion_id + ': evidence outside transcript');
      }
      const key = String(officialCriterionKeys.indexOf(c.criterion_id) + 1).padStart(2, '0');
      return c.value === null
        ? { criterionKey: key, isNa: true, naConditionMet: true, naReason: c.rationale }
        : { criterionKey: key, value: c.value };
    });
    const score = calculateScore(confirmed.has(r.conversation_id) ? voiceChecklist : checklist, answers);
    if (score.total !== r.score.final_score || score.grossError !== r.score.critical_flag) {
      throw Error(r.conversation_id + ': score does not match criterion values');
    }
  }
  console.log(JSON.stringify({ records: file.results.length, ok: file.results.length - errors.length,
    error: errors.length, errorIds: errors, declaredModel: file.model }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
