import { readFileSync } from 'node:fs';
import * as p from './patterns.mjs';
import { fail } from './http.mjs';

export const LOCAL_MODEL = 'CQA rules-v1';
export const official = JSON.parse(readFileSync(new URL('../prisma/seed/official-checklist.json', import.meta.url)));
const trim = (value = '') => (value ?? '').trim().toLowerCase().replace(/\s+/gu, ' ');
const first = list => list[0];
const last = list => list.at(-1);
const matching = (turns, re) => turns.find(t => re.test(t.text));
const after = (turns, turn) => turn ? turns.filter(t => t.turnIndex > turn.turnIndex) : [];
function decision(answer, explanation, evidence, range = null) {
  const seen = new Set();
  const proof = evidence.filter(t => t && !seen.has(t.turnIndex) && seen.add(t.turnIndex))
    .map(({turnIndex, text}) => ({turnIndex, quote: text.trim().slice(0, 10000)}));
  return {answer, explanation, na: answer === null, na_reason: answer === null ? explanation : null,
    evidence: proof, checked_range: range};
}

function readDialogue({ transcript, language, channel }) {
  const operators = transcript.filter(t => t.speaker === 'operator');
  const clients = transcript.filter(t => t.speaker === 'client');
  const firstOp = first(operators), lastOp = last(operators);
  const requests = clients.filter(t => !p.smallTalk.test(t.text) && (
    p.topic.test(t.text) || p.vague.test(t.text) || (!p.transfer.test(t.text) && p.question.test(t.text))
  ));
  const question = first(requests);
  const clarification = operators.find(t => p.question.test(t.text) && !p.closingHelp.test(t.text)
    && !/чем (?:могу )?помочь|how can i help|қалай көмектес/iu.test(t.text));
  const initialRequests = requests.filter(t => !firstOp || t.turnIndex < firstOp.turnIndex);
  const urgency = matching(clients, p.distress);
  const solutions = operators.filter(t => p.actionable.test(t.text) && (!question || t.turnIndex > question.turnIndex));
  const lastRequest = last(requests);
  const uncaught = lastRequest && !after(operators, lastRequest).some(t => p.actionable.test(t.text)
    || /^(?:да|нет|иә|жоқ|yes|no)(?=[.!?,\s]|$)/iu.test(t.text) || t.text.length > 65 && !p.farewell.test(t.text));
  const issue = matching(clients, p.unclear);
  const full = {start: 0, end: transcript.length - 1};
  const opening = {start: 0, end: firstOp?.turnIndex ?? full.end};
  const anchor = question ?? first(clients) ?? first(transcript);
  const rude = matching(operators, p.abuse);
  const identity = matching(transcript.filter(t => ['operator', 'system'].includes(t.speaker)), p.verified);
  const protectedAction = matching(operators, p.protectedAction);
  const protectedRequest = matching(clients, p.protectedQuery);
  const closing = operators.slice(-2);
  const goodbye = lastOp && p.farewell.test(lastOp.text) ? lastOp : null;
  const offer = matching(closing, p.closingHelp);
  const interruption = matching(transcript.filter(t => t.speaker === 'system'), p.disconnect);
  return { transcript, language, channel, operators, clients, firstOp, lastOp, question, clarification,
    initialRequests, urgency, solutions, lastRequest, uncaught, issue, full, opening, anchor, rude, identity,
    protectedAction, protectedRequest, goodbye, offer, interruption };
}

const officialRules = {
  '01'(d, c) {
    const missing = d.channel === 'voice call' && c.allowNa && matching(d.transcript.filter(t => t.speaker === 'system'),
      /(?:начало записи|начало разговора).{0,25}(?:пропущено|отсутствует)|recording (?:starts mid-call|start missing)|жазбаның басы жоқ/iu);
    if (missing) return decision(null, 'Системная отметка подтверждает, что начало звонка отсутствует.', [missing]);
    const hello = !!d.firstOp && p.greetings[d.language].test(d.firstOp.text);
    const introduced = !!d.firstOp && p.introduction.test(d.firstOp.text);
    const pass = hello && introduced;
    const reason = pass ? 'В первом ответе есть приветствие на языке диалога и представление оператора.'
      : !d.firstOp ? 'В транскрипте нет ответа оператора.' : 'В первом ответе не найдено ' +
        [!hello && 'приветствие на языке клиента', !introduced && 'представление оператора'].filter(Boolean).join(' и ') + '.';
    return decision(pass, reason, [d.firstOp ?? d.anchor], d.opening);
  },
  '02'(d, c) {
    const known = d.initialRequests.find(t => !p.vague.test(t.text));
    const clarified = d.clarification && after(d.clients, d.clarification).find(t => !p.smallTalk.test(t.text));
    if (c.allowNa && known && !d.clarification) return decision(null,
      'Клиент описал конкретный запрос до ответа оператора. Признаков необходимости уточнения не найдено.', [known, first(d.solutions)]);
    const pass = !!clarified && (!first(d.solutions) || d.clarification.turnIndex <= first(d.solutions).turnIndex);
    return decision(pass, pass ? 'Оператор задал уточняющий вопрос до инструкции и получил дополнительные сведения.'
      : 'Не найдено уточнение недостающих деталей с ответом клиента до консультации.', [d.anchor, d.clarification, clarified], d.full);
  },
  '03'(d, c) {
    if (c.allowNa && !d.protectedRequest && !d.protectedAction && !d.identity) return decision(null,
      'В запросе и ответах не обнаружены раскрытие личных данных или запрос на защищённое действие.', [d.anchor, first(d.solutions) ?? d.firstOp]);
    const pass = !!d.identity && (!d.protectedAction || d.identity.turnIndex < d.protectedAction.turnIndex);
    return decision(pass, pass ? 'Подтверждение проверки личности присутствует до защищённого действия или раскрытия сведений.'
      : 'До запроса персональных данных или защищённого действия подтверждение проверки личности не найдено.',
      [d.protectedRequest, d.identity, d.protectedAction, d.anchor], d.full);
  },
  '04'(d, c) {
    if (c.allowNa && !d.question) return decision(null, 'До окончания диалога содержательный запрос клиента не обнаружен.',
      [d.anchor, last(d.transcript)], d.full);
    const solution = first(d.solutions);
    if (!solution) {
      const hint = d.operators.find(t => /проверю|уточню|попробуйте|проверьте|қарап көр|тексерем|i.ll check|i will check|try again/iu.test(t.text));
      return decision(hint ? 5 : 0, hint ? 'Найдена общая подсказка, конкретный следующий шаг не указан.'
        : 'Правила не обнаружили содержательную инструкцию или следующий шаг.', [d.anchor, hint ?? d.firstOp], d.full);
    }
    if (d.uncaught) return decision(10, 'Инструкция по основной теме есть. На последний запрос не найдена отдельная инструкция или ответ.',
      [solution, d.lastRequest, d.lastOp], d.full);
    if (d.issue) return decision(15, 'Оператор дал инструкцию, но по ходу разговора клиенту пришлось уточнять детали.',
      [solution, d.issue, d.lastOp], d.full);
    return decision(20, 'В ответе есть конкретное действие или следующий шаг. По текстовым признакам открытых вопросов не обнаружено.',
      [d.question, solution, matching(d.clients, p.resolved)]);
  },
  '05'(d) {
    if (d.rude || !d.firstOp) return decision(false, d.rude ? 'В ответе оператора найдено оскорбительное обращение.'
      : 'Реплики оператора отсутствуют.', [d.rude ?? d.anchor], d.full);
    if (d.urgency) {
      const reaction = matching(after(d.operators, d.urgency), p.empathy);
      return decision(!!reaction, reaction ? 'После сообщения клиента о неудобстве оператор признал его проблему.'
        : 'После выраженного беспокойства не найдена явная реакция на неудобство.',
        [d.urgency, reaction ?? d.lastOp], d.full);
    }
    const polite = d.operators.find(t => p.greetings[d.language].test(t.text) || p.farewell.test(t.text)
      || /пожалуйста|спасибо|рақмет|өтінемін|please|thank you/iu.test(t.text));
    return decision(!!polite, polite ? 'Найдена вежливая формулировка. Явного сообщения о недовольстве правила не обнаружили.'
      : 'В репликах оператора не найдено признаков вежливого обращения.', [polite ?? d.firstOp], d.full);
  },
  '06'(d) {
    if (!d.firstOp) return decision(0, 'Отсутствуют реплики оператора, которые позволили бы проследить ход ответа.', [d.anchor], d.full);
    if (d.issue) return decision(4, 'Клиент явно просит разъяснить формулировку или повторить инструкцию.', [d.issue, d.firstOp], d.full);
    const wait = matching(d.clients, p.waitingClient);
    if (wait && !matching(d.operators.filter(t => t.turnIndex < wait.turnIndex), p.waitNotice)) {
      return decision(7, 'Клиент спрашивает об ожидании. Предварительное предупреждение не обнаружено.', [d.firstOp, wait], d.full);
    }
    if (d.uncaught && !p.acknowledgement.test(d.lastRequest.text)) return decision(7, 'Последний вопрос клиента остался без распознаваемого ответа.',
      [d.lastRequest, d.lastOp], d.full);
    return decision(10, 'Явных просьб повторить ответ и ожидания без предупреждения не обнаружено.', [d.firstOp, d.lastOp], d.full);
  },
  '07'(d, c) {
    if (c.allowNa && d.interruption && !d.goodbye && (!d.lastOp || d.interruption.turnIndex > d.lastOp.turnIndex)) {
      return decision(null, 'Системная отметка сообщает об отключении клиента до завершения разговора.', [d.interruption], d.full);
    }
    const pass = !!(d.goodbye && d.offer);
    return decision(pass, pass ? 'В конце диалога оператор попрощался и предложил помощь или подвёл итог.'
      : 'В конце диалога не найдены все элементы завершения: прощание и итог или предложение дальнейшей помощи.',
      [d.offer, d.goodbye ?? d.lastOp ?? d.anchor], d.full);
  },
  '08'(d) {
    const paid = matching(d.operators, p.privateOffer);
    const leak = matching(d.operators, p.disclosure);
    const problem = d.rude ?? paid ?? leak;
    return decision(!!problem, d.rude ? 'Найдено оскорбительное обращение оператора.' : paid ?
      'Обнаружено предложение перевода средств лично оператору или платной частной консультации.' : leak ?
      'Оператор указывает персональные сведения другого клиента.' : 'В репликах оператора не найдены признаки оскорбления, частной платной услуги или раскрытия сведений.',
      problem ? [problem] : [d.firstOp ?? d.anchor, d.lastOp], d.full);
  },
};

function unsupported(criterion) {
  fail(422, 'LOCAL_RULE_UNSUPPORTED', 'Для критерия «' + criterion.name + '» требуется оценка Gemini. ' +
    'Локально доступны исходные правила и критерий с описанием: Оператор использует фразу «текст».');
}

function evaluateCriterion(d, criterion) {
  const literal = /^оператор использует фразу\s+[«"]([^»"]{1,180})[»"]\.?$/iu.exec(criterion.description.trim());
  if (literal && ['boolean', 'flag'].includes(criterion.type) && !criterion.allowNa) {
    const needle = trim(literal[1]);
    if (!needle) unsupported(criterion);
    const match = d.operators.find(t => trim(t.text).includes(needle));
    return decision(!!match, match ? 'В реплике оператора найдена заданная фраза.' : 'Заданная фраза в репликах оператора отсутствует.',
      [match ?? d.firstOp ?? d.anchor], d.full);
  }
  const base = official.criteria.find(c => c.type === criterion.type && trim(c.description) === trim(criterion.description));
  if (!base) unsupported(criterion);
  const amendedGreeting = base.key === '01' && trim(criterion.naCondition).includes('начало записи отсутствует');
  if (criterion.allowNa && !amendedGreeting && trim(criterion.naCondition) !== trim(base.naCondition)) unsupported(criterion);
  const verdict = officialRules[base.key](d, criterion);
  if (criterion.type === 'scale') {
    // Match by the actual meaning of each step, allowing users to renumber the scale.
    const steps = criterion.scaleSteps ?? [];
    const byLabel = new Map(steps.map(step => [trim(step.label), step.value]));
    if (byLabel.size !== base.scaleSteps.length || !base.scaleSteps.every(step => byLabel.has(trim(step.label)))) unsupported(criterion);
    if (!verdict.na) verdict.answer = byLabel.get(trim(base.scaleSteps.find(s => s.value === verdict.answer).label));
  }
  return verdict;
}

export function evaluateLocal(input) {
  const d = readDialogue(input);
  return input.checklist.criteria.map(c => ({criterion_id: c.key, ...evaluateCriterion(d, c)}));
}
