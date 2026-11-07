<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import PagedList from '../../shared/PagedList.vue'
const route = useRoute()
const voice = computed(() => route.query.channel === 'voice call')
</script>

<template>
  <section class="conversation-list">
    <h1>Диалоги</h1>
    <RouterLink :to="{ name: 'conversations', query: voice ? {} : { channel: 'voice call' } }">{{ voice ? 'Все диалоги' : 'Голосовые звонки' }}</RouterLink>
    <PagedList :key="voice" :path="voice ? '/conversations?channel=voice%20call' : '/conversations'" empty-text="Диалогов пока нет." v-slot="{ item }">
      <RouterLink :to="{ name: 'conversation', params: { id: item.id } }">{{ item.externalId }}</RouterLink>
      <span class="meta">{{ item.language }} · {{ item.channel }}</span>
    </PagedList>
  </section>
</template>
