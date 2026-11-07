<script setup>
import RemoteData from '../../shared/RemoteData.vue'
import ConversationCard from './ConversationCard.vue'

defineProps({ id: { type: String, required: true } })
</script>

<template>
  <section class="conversation-detail">
    <RouterLink :to="{ name: 'conversations' }">← Диалоги</RouterLink>
    <RemoteData :path="`/conversations/${encodeURIComponent(id)}`" v-slot="{ payload: { data } }">
      <ConversationCard :key="data.id" :conversation="data" />
    </RemoteData>
  </section>
</template>
