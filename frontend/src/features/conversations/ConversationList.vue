<script setup>
import PagedList from '../../shared/PagedList.vue'
</script>

<template>
  <section class="conversation-list">
    <h1>Диалоги</h1>
    <p><RouterLink :to="{ name: 'audio-demo' }">Открыть демозвонок с разбором аудио</RouterLink></p>
    <PagedList path="/conversations" empty-text="Диалогов пока нет." v-slot="{ item }">
      <RouterLink :to="{ name: 'conversation', params: { id: item.id } }">{{ item.externalId }}</RouterLink>
      <span class="meta">{{ item.language }} · {{ item.channel }}</span>
    </PagedList>
  </section>
</template>
