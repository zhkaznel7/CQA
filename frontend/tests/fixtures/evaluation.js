export const conversation = {
  id: 'demo-chat', externalId: 'Демо · Поиск отчёта', language: 'RU', channel: 'agent chat',
  transcript: [
    { speaker: 'system', timestamp: '00:00', text: 'Чат открыт.' },
    { speaker: 'client', timestamp: '00:03', text: 'Где найти отчёт за прошлый месяц?' },
    { speaker: 'operator', timestamp: '00:09', text: 'Здравствуйте, меня зовут Анна. В истории операций выберите прошлый месяц.' },
    { speaker: 'system', timestamp: '00:15', text: 'Оператор завершил чат.' },
  ],
}

// Сокращённый пользовательский чек-лист для демо. Баллы имитируют ответ сервера.
const criteria = [
  { id: 'c1', key: 'contact', name: 'Установление контакта' },
  { id: 'c2', key: 'identification', name: 'Идентификация' },
  { id: 'c3', key: 'closure', name: 'Завершение' },
]
const checklist = { id: 'demo-rules', name: 'Демочат', version: 1, criteria }
const naReason = 'Общий вопрос о поиске отчёта не требует проверки личности.'
const evaluation = {
  id: 'demo-result', isMock: true,
  score: {
    total: 50, grossError: false,
    sections: [{ key: 'service', name: 'Обслуживание', points: 50, maxPoints: 100 }],
    criteria: [
      { key: 'contact', type: 'boolean', value: true, weight: 40, points: 50 },
      { key: 'identification', type: 'boolean', value: null, isNa: true, weight: 20, points: 0 },
      { key: 'closure', type: 'boolean', value: false, weight: 40, points: 0 },
    ],
  },
  results: [
    { criterionId: 'c1', criterionKey: 'contact', answer: true, explanation: 'Оператор поздоровался и представился.',
      evidence: [{ turnIndex: 2, quote: 'Здравствуйте, меня зовут Анна.' }] },
    { criterionId: 'c2', criterionKey: 'identification', isNa: true, naReason,
      explanation: 'Клиент не запрашивал личные данные.', evidence: [{ turnIndex: 1, quote: 'Где найти отчёт' }] },
    { criterionId: 'c3', criterionKey: 'closure', answer: false,
      explanation: 'После инструкции оператор не предложил дальнейшую помощь и не попрощался.',
      evidence: [], checkedRange: { start: 2, end: 3 } },
  ],
}
export const demoService = {
  async listVersions() { return [checklist] },
  async history() { return [] },
  async open() { return { checklist, evaluation, currentScore: evaluation.score, reused: true } },
  async evaluate() { return { checklist, evaluation, currentScore: evaluation.score, reused: false } },
}
