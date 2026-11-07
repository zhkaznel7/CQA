export const routes = [
  { path: '/', redirect: { name: 'conversations' } },
  {
    path: '/demo/evaluation', name: 'evaluation-demo',
    component: () => import('../features/evaluations/DemoEvaluationPage.vue'),
  },
  {
    path: '/demo/audio', name: 'audio-demo',
    component: () => import('../features/audio-review/AudioDemoPage.vue'),
  },
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
