<script setup>
import PagedList from '../../shared/PagedList.vue'
</script>

<template>
  <section class="checklist-list">
    <h1>Чек-листы</h1>
    <PagedList path="/checklists" empty-text="Чек-листов пока нет." v-slot="{ item }">
      <strong>{{ item.name }}</strong>
      <span class="meta">Версия {{ item.version }}</span>
    </PagedList>
  </section>
</template>
