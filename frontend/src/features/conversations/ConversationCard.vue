<script setup>
import { nextTick, ref } from 'vue'
import EvaluationPanel from '../evaluations/EvaluationPanel.vue'

const props = defineProps({
  conversation: { type: Object, required: true },
  service: Object,
})
const activeRange = ref(null)
const transcript = ref(null)
const audio = ref(null)
const useOrganizerPlayer = ref(false)

function onAudioError() {
  const url = new URL(props.conversation.audioUrl, window.location.href)
  if (url.protocol === 'https:' && url.hostname.endsWith('.environment.api.powerplatform.com') &&
      url.pathname.startsWith('/powerautomate/automations/direct/')) {
    useOrganizerPlayer.value = true
  }
}

async function showEvidence(range) {
  const turns = props.conversation.transcript
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) ||
      range.start < 0 || range.end < range.start || range.end >= turns.length) return
  activeRange.value = range
  await nextTick()
  transcript.value?.children[range.start]?.focus()
  const offset = turns[range.start].startMs
  if (audio.value && offset != null && offset !== '' && Number.isFinite(Number(offset)) && Number(offset) >= 0) {
    audio.value.currentTime = Number(offset) / 1000
  }
}
</script>

<template>
  <h1>{{ conversation.externalId }}</h1>
  <p class="meta">{{ conversation.language }} · {{ conversation.channel }}</p>
  <template v-if="useOrganizerPlayer">
    <iframe :src="conversation.audioUrl" title="Запись звонка у организатора" sandbox="" referrerpolicy="no-referrer" />
    <a :href="conversation.audioUrl" target="_blank" rel="noopener noreferrer">Открыть запись у организатора</a>
  </template>
  <audio v-else-if="conversation.audioUrl" @error="onAudioError" ref="audio" :src="conversation.audioUrl" controls preload="metadata" aria-label="Запись звонка" />
  <h2>Транскрипт</h2>
  <ol ref="transcript" class="transcript">
    <li v-for="(turn, index) in conversation.transcript" :id="`turn-${index + 1}`" :key="index" tabindex="-1">
      <strong>{{ turn.speaker }}</strong> <span>{{ turn.timestamp }}</span>
      <p><mark v-if="activeRange && index >= activeRange.start && index <= activeRange.end">{{ turn.text }}</mark><template v-else>{{ turn.text }}</template></p>
    </li>
  </ol>
  <EvaluationPanel :key="conversation.id" :conversation-id="conversation.id" :service="service" @evidence="showEvidence" />
</template>

<style scoped>
iframe { display: block; width: 100%; height: 14rem; border: 0; }
</style>
