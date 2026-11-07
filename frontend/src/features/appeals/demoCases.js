// Синтетические примеры. Готовые итоги для каждого допустимого решения заданы в фикстуре.
export const demoCases = [
  {
    id: 'tariffs', evaluationId: 'demo-inbox-tariffs', criterionId: 'consultation',
    title: 'Тарифы и дата обновления', criterion: 'Корректность и полнота консультации',
    original: 15, scale: [0, 5, 10, 15, 20], totalsByScore: { 0: 65, 5: 70, 10: 75, 15: 80, 20: 85 },
    explanation: 'Основной вопрос закрыт, ответ о дате обновления признан неполным.',
    turns: [
      ['Клиент', 'Где посмотреть тарифы и как узнать дату их обновления?'],
      ['Оператор', 'Откройте раздел «Тарифы». Дата обновления указана под таблицей.'],
    ],
    initial: { comment: 'Во второй фразе я указал, где найти дату. Прошу проверить оценку.', decision: null },
  },
  {
    id: 'report', evaluationId: 'demo-inbox-report', criterionId: 'dialogue',
    title: 'Поиск отчёта', criterion: 'Управление диалогом',
    original: 7, scale: [0, 4, 7, 10], totalsByScore: { 0: 70, 4: 76, 7: 80.5, 10: 85 },
    explanation: 'Клиенту пришлось уточнить, какую кнопку нажать.',
    turns: [
      ['Клиент', 'Как скачать отчёт?'], ['Оператор', 'Откройте историю операций.'],
      ['Клиент', 'А где скачать?'], ['Оператор', 'Нажмите «Экспорт» и выберите PDF.'],
    ],
    initial: { comment: 'Прошу проверить последовательность инструкции.', decision: {
      action: 'confirm', score: 7, reason: 'Шаг экспорта указан только после повторного вопроса клиента.',
    } },
  },
  {
    id: 'period', evaluationId: 'demo-inbox-period', criterionId: 'consultation',
    title: 'Выписка за период', criterion: 'Корректность и полнота консультации',
    original: 10, scale: [0, 5, 10, 15, 20], totalsByScore: { 0: 60, 5: 65, 10: 70, 15: 75, 20: 80 },
    explanation: 'Указан раздел, но пропущен выбор дат.',
    turns: [['Клиент', 'Как получить выписку за июль?'], ['Оператор', 'Откройте раздел «Выписки».']],
    initial: null,
  },
]

export function appealStatus(appeal) {
  if (!appeal) return 'Можно подать обращение'
  return appeal.decision ? 'Рассмотрено' : 'На рассмотрении'
}
