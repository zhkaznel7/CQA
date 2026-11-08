export const sections = [
  { path: '/', label: 'Обзор', icon: 'grid', group: 'Аналитика', routes: ['overview'] },
  { path: '/dialogs', label: 'Диалоги', icon: 'messages', group: 'Аналитика', routes: ['conversation', 'conversations'] },
  { path: '/datasets', label: 'Наборы данных', icon: 'layers', group: 'Управление', routes: ['datasets'] },
  { path: '/checklists', label: 'Чек-листы', icon: 'clipboard', group: 'Управление', routes: ['checklists','checklist-editor','checklist-new'] },
  { path: '/appeals', label: 'Апелляции', icon: 'scale', group: 'Управление', routes: ['appeal','appeals'] },
]
