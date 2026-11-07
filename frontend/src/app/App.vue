<template>
  <header class="app-header">
    <nav class="app-nav" aria-label="Разделы приложения">
      <ul>
        <li><RouterLink to="/dialogs" :class="{ 'section-active': $route.name === 'conversation' }">Диалоги</RouterLink></li>
        <li><RouterLink to="/checklists">Чек-листы</RouterLink></li>
        <li><RouterLink to="/appeals">Апелляции</RouterLink></li>
      </ul>
    </nav>
  </header>
  <main class="app-content">
    <RouterView />
  </main>
</template>
