export const routes = [
  { path: '/', alias: '/overview', name: 'overview', component: () => import('../features/overview/OverviewPage.vue') },
  { path: '/datasets', name: 'datasets', component: () => import('../features/datasets/DatasetPage.vue') },
  {
    path: '/checklists/new', name: 'checklist-new',
    component: () => import('../features/checklists/ChecklistPage.vue'),
  },
  {
    path: '/checklists/:id', name: 'checklist-editor', props: true,
    component: () => import('../features/checklists/ChecklistPage.vue'),
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
    path: '/appeals/:id', name: 'appeal', props: true,
    component: () => import('../features/appeals/AppealDetail.vue'),
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
