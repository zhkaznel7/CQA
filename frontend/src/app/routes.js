export const routes = [
  { path: '/', redirect: { name: 'conversations' } },
  {
    path: '/dialogs', name: 'conversations',
    component: () => import('../features/conversations/ConversationList.vue'),
  },
  {
    path: '/dialogs/:id', name: 'conversation', props: true,
    component: () => import('../features/conversations/ConversationDetail.vue'),
  },
  {
    path: '/checklists', name: 'checklists',
    component: () => import('../features/checklists/ChecklistList.vue'),
  },
  {
    path: '/appeals', name: 'appeals',
    component: () => import('../features/appeals/AppealList.vue'),
  },
]
