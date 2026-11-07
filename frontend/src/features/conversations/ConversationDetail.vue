<script setup>
import RemoteData from '../../shared/RemoteData.vue'

defineProps({ id: { type: String, required: true } })
</script>

<template>
  <section class="conversation-detail">
    <RouterLink :to="{ name: 'conversations' }">← Диалоги</RouterLink>
    <RemoteData :path="`/conversations/${encodeURIComponent(id)}`" v-slot="{ payload: { data } }">
      <h1>{{ data.externalId }}</h1>
      <p class="meta">{{ data.language }} · {{ data.channel }}</p>
      <audio v-if="data.audioUrl" :src="data.audioUrl" controls preload="none" aria-label="Запись звонка" />
      <h2>Транскрипт</h2>
      <ol class="transcript">
        <li v-for="(turn, index) in data.transcript" :id="`turn-${index + 1}`" :key="index">
          <strong>{{ turn.speaker }}</strong> <span class="meta">{{ turn.timestamp }}</span>
          <p>{{ turn.text }}</p>
        </li>
      </ol>
    </RemoteData>
  </section>
</template>
