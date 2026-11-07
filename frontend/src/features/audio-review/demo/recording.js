import audioUrl from './call.wav?url'
import turns from './turns.json'

// Интервалы в секундах от начала именно этой записи. Замечания заданы для демо.
export const demoRecording = {
  audioUrl,
  turns,
  findings: [
    {
      id: 'greeting', criterion: 'Установление контакта',
      start: turns[0].start, end: turns[0].words[3].end,
      explanation: 'Оператор поздоровался и представился по имени.',
    },
    {
      id: 'next-step', criterion: 'Полнота консультации',
      start: turns[2].start, end: turns[2].end,
      explanation: 'Оператор назвал два действия для поиска отчёта.',
    },
  ],
}
