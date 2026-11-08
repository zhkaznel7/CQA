import officialChecklist from '../../../prisma/seed/official-checklist.json' with { type: 'json' };

const identity = officialChecklist.criteria.find(criterion => criterion.key === '03');
const sourceTurnFields = new Set(['turnIndex', 'speaker', 'text', 'timestamp', 'startMs', 'endMs']);
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
  .replace(/→/g, ' > ').replace(/[-‐‑–—]/g, ' ')
  .replace(/[«»“”".,!?:;()]/g, ' ').replace(/\s+/g, ' ').trim();
const clauses = text => text.split(/[.!?]+/u).map(normalize).filter(Boolean);

// Reviewed public UI instructions, matched as whole statements, never by a keyword
// or conversation ID. Unknown wording remains unconfirmed, not guessed to be public.
const navigationRequest = /^(?:подскажите )?(?:где|как) (?:можно )?(?:взять|найти|открыть|скачать|посмотреть) (?:отчет брокера|отчеты|свой тариф|название тарифа)$/;
const fundingNavigationRequest = /^(?:(?:скажите|подскажите) )?где (?:в приложении )?скачать реквизиты пополнения$/;
const clientStatements = [
  navigationRequest,
  fundingNavigationRequest,
  /^там много кнопок подключите оператора пожалуйста$/,
  /^там много кнопок$/,
  /^подключите оператора пожалуйста$/,
  /^я писал выше нужны реквизиты какую кнопку нажать$/,
  /^я писал выше$/,
  /^нужны реквизиты какую кнопку нажать$/,
  /^да пожалуйста$/,
  /^(?:и еще )?хочу посмотреть (?:какой у меня тариф|свой тариф)$/,
  /^я в приложении подключите человека не могу найти (?:сами )?отчеты$/,
  /^телефон под рукой приложение уже открыто$/,
  /^там есть даты что дальше$/,
  /^(?:открыл|открыла) а где (?:прямо )?в документе тариф$/,
  /^(?:слушайте )?а в веб версии без отчета можно$/,
  /^а даты на название тарифа влияют$/,
  /^я случайно выбрал(?:а)? прошлый месяц$/,
  /^(?:понял[а]? )?а отчет можно оставить за прошлый месяц$/,
  /^он мне для сверки$/,
  /^(?:окей )?тогда оставлю как есть$/,
  /^(?:я в приложении|подключите человека не могу найти (?:сами )?отчеты|там есть даты|что дальше|открыл|открыла|а где (?:прямо )?в документе тариф|спасибо больше ничего)$/,
  /^(?:да|нет|спасибо|понял|поняла|вижу|хорошо|больше ничего|окей)$/,
];
const navigationStatements = [
  // Confirms only a self-service context; it does not prove a helpful consultation.
  /^все есть в приложении$/,
  /^откройте (?:раздел )?меню > отчеты и документы > отчет брокера$/,
  /^выберите период и скачайте отчет$/,
  /^на первой странице в разделе информация о счете$/,
  /^(?:да )?там название тарифа отображается под фио во вкладке кабинет$/,
  /^отчет формируется за выбранный период$/,
  /^если нужен (?:именно )?текущий тариф удобнее посмотреть его в веб кабинете$/,
  /^(?:да )?для сверки выберите тот период который хотите проверить$/,
];
const courtesies = [
  /^добрый день я [а-я]{1,40}$/,
  /^чем могу помочь$/,
  /^здравствуйте(?: меня зовут [а-я]{1,40})?$/,
  /^(?:пожалуйста|хорошего (?:дня|вечера)|до свидания)$/,
];
// Boilerplate is context, not proof of authentication or consent to disclosure.
const botStatements = new Set([
  'Здравствуйте! Я AIM, AI-ассистент Freedom Broker. Я могу ответить на вопросы о продуктах и услугах, предоставить информацию по вашим счетам, активам и комиссиям, сравнить данные в таблице, отправить контакты вашего менеджера и передать вопрос специалистам поддержки.',
  'Продолжая разговор, Вы соглашаетесь на сбор и обработку персональных данных и подтверждаете, что ознакомились с Политикой конфиденциальности Компании.',
  'Тариф можно найти на первой странице отчёта брокера.',
  'В приложении есть раздел «Пополнить».',
  'Желаете, чтобы я соединил Вас с оператором?',
  'Пожалуйста, ожидайте. Оператор скоро подключится к чату.',
].map(normalize));

/**
 * A deliberately narrow independent confirmation of public self-service navigation.
 * No AI answer/reason, externalId, claimed auth, or substring match can grant N/A.
 * This is not a general semantic classifier. RU wording outside this grammar and
 * other languages retain the existing confirmation/review path.
 */
export function confirmsIdentityNotRequired(criterion, conversation) {
  if (criterion.key !== identity.key || criterion.type !== 'boolean' || !criterion.allowNa
    || criterion.applicabilityRule || criterion.description !== identity.description
    || criterion.naCondition !== identity.naCondition || conversation.language !== 'RU'
    || !Array.isArray(conversation.transcript) || !conversation.transcript.length) return false;

  let request = false;
  let navigation = false;
  for (const turn of conversation.transcript) {
    if (typeof turn?.text !== 'string' || !turn.text.trim() || typeof turn.speaker !== 'string') return false;
    if (Object.keys(turn).some(key => !sourceTurnFields.has(key))) return false;
    const speaker = turn.speaker.trim().toLowerCase();
    const text = normalize(turn.text);
    if (speaker === 'bot') {
      if (!botStatements.has(text)) return false;
      continue;
    }
    if (speaker === 'system') {
      // A known end event is context for identity only, never proof of closure N/A.
      if (!['эскалация на оператора', 'оператор закрыл чат'].includes(text)) return false;
      continue;
    }
    if (!['operator', 'client'].includes(speaker)) return false;
    // No disclosed values, identifiers, links or credentials in this public grammar.
    if (/[\d@:/\\\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(turn.text)) return false;
    const statements = clauses(turn.text);
    if (!statements.length) return false;
    for (const statement of statements) {
      if (speaker === 'client') {
        if (!clientStatements.some(pattern => pattern.test(statement))) return false;
        request ||= navigationRequest.test(statement) || fundingNavigationRequest.test(statement);
      } else {
        const isNavigation = navigationStatements.some(pattern => pattern.test(statement));
        if (!isNavigation && !courtesies.some(pattern => pattern.test(statement))) return false;
        navigation ||= isNavigation;
      }
    }
  }
  return request && navigation;
}
