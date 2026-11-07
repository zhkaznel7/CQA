// Synthetic examples only. Not organizer data or an official checklist.
export const mockConversations = [
  { externalId: 'mock-ru-001', language: 'RU', channel: 'voice', audioUrl: null,
    transcript: [
      { turnIndex: 0, speaker: 'operator', text: 'Здравствуйте! Это тестовый диалог.', timestamp: '00:00:01.250' },
      { turnIndex: 1, speaker: 'client', text: 'Проверяю работу прототипа.', timestamp: '00:00:03.000' },
    ] },
  { externalId: 'mock-kz-001', language: 'KZ', channel: 'chat', audioUrl: null,
    transcript: [{ turnIndex: 0, speaker: 'operator', text: 'Сәлеметсіз бе! Бұл тест диалогы.', timestamp: '2026-01-01T10:00:00+06:00' }] },
  { externalId: 'mock-en-001', language: 'EN', channel: 'voice', audioUrl: null,
    transcript: [{ turnIndex: 0, speaker: 'operator', text: 'Hello! This is a synthetic conversation.', startMs: 1250, endMs: 3000 }] },
];
