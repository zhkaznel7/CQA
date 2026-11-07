<script setup>
import PagedList from '../../shared/PagedList.vue'
</script>

<template>
  <section class="conversation-list">
    <h1>Диалоги</h1>
    <PagedList path="/conversations" empty-text="Диалогов пока нет." v-slot="{ item }">
      <RouterLink :to="{ name: 'conversation', params: { id: item.id } }">{{ item.externalId }}</RouterLink>
      <span class="meta">{{ item.language }} · {{ item.channel }}</span>
    </PagedList>
  </section>
</template>
