<script setup>
import RemoteData from '../../shared/RemoteData.vue'
import AppIcon from '../../shared/AppIcon.vue'
import ConversationCard from './ConversationCard.vue'

defineProps({ id: { type: String, required: true } })
</script>

<template>
  <section class="conversation-detail">
    <RouterLink class="dialog-back" :to="{ name: 'conversations' }"><AppIcon name="arrow-right" /> К списку диалогов</RouterLink>
    <RemoteData :path="`/conversations/${encodeURIComponent(id)}`" v-slot="{ payload: { data } }">
      <ConversationCard :key="data.id" :conversation="data" />
    </RemoteData>
  </section>
</template>

<style scoped>
.conversation-detail { min-width: 0; }
.dialog-back { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: #2964aa; text-decoration: none; margin-bottom: 18px; }
.dialog-back:hover { text-decoration: underline; }
.dialog-back svg { width: 16px; height: 16px; transform: rotate(180deg); }
</style>
