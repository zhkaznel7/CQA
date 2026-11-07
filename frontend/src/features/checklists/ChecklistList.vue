<script setup>
import PagedList from '../../shared/PagedList.vue'
</script>

<template>
  <section class="checklist-list">
    <h1>Чек-листы</h1>
    <p><RouterLink :to="{ name: 'checklist-new' }">Создать чек-лист</RouterLink></p>
    <p><RouterLink :to="{ name: 'checklist-demo' }">Попробовать редактор без сервера</RouterLink></p>
    <PagedList path="/checklists" empty-text="Чек-листов пока нет." v-slot="{ item }">
      <RouterLink :to="{ name: 'checklist-editor', params: { id: item.id } }">{{ item.name }} · версия {{ item.version }}</RouterLink>
    </PagedList>
  </section>
</template>
