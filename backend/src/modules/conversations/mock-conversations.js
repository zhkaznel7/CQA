// Short original transcripts for trying the workflow before importing a dataset.
export const mockConversations = [
  {
    externalId: 'demo-ru-001', language: 'RU', channel: 'agent chat', audioUrl: null,
    transcript: [
      { speaker: 'client', timestamp: '00:00', text: 'Здравствуйте! Где посмотреть тарифы на обслуживание?' },
      { speaker: 'operator', timestamp: '00:12', text: 'Здравствуйте! Меня зовут Анна. Откройте раздел «Тарифы» в приложении.' },
      { speaker: 'client', timestamp: '00:29', text: 'Нашёл, спасибо.' },
      { speaker: 'operator', timestamp: '00:34', text: 'Могу ли я ещё чем-то помочь? Всего доброго!' },
    ],
  },
  {
    externalId: 'demo-kz-001', language: 'KZ', channel: 'agent chat', audioUrl: null,
    transcript: [
      { speaker: 'client', timestamp: '00:00', text: 'Сәлеметсіз бе! Қосымшада тарифтерді қайдан көремін?' },
      { speaker: 'operator', timestamp: '00:14', text: 'Сәлеметсіз бе! Менің атым Айдана. Қосымшадағы «Тарифтер» бөліміне өтіңіз.' },
      { speaker: 'client', timestamp: '00:24', text: 'Рақмет, таптым.' },
    ],
  },
  {
    externalId: 'demo-en-001', language: 'EN', channel: 'voice call', audioUrl: null,
    transcript: [
      { speaker: 'client', timestamp: '2026-01-02T09:00:00+05:00', text: 'Hello, I cannot find my monthly statement. Where should I look?' },
      { speaker: 'operator', timestamp: '2026-01-02T09:00:13+05:00', text: 'Hello, my name is Alex. Open Documents, choose Statements, and select the month.' },
      { speaker: 'client', timestamp: '2026-01-02T09:00:29+05:00', text: 'I found it, thank you.' },
      { speaker: 'operator', timestamp: '2026-01-02T09:00:32+05:00', text: 'Can I help with anything else? Have a good day!' },
    ],
  },
];
