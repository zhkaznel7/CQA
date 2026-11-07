<script setup>
import { computed, nextTick, ref, shallowRef } from 'vue'
import EvaluationPanel from '../evaluations/EvaluationPanel.vue'
import AudioReview from '../audio-review/AudioReview.vue'
import { recordingFor } from '../audio-review/recording.js'

const props = defineProps({ conversation: { type: Object, required: true }, service: Object })
const activeRange = ref(null)
const transcript = ref(null)
const audio = ref(null)
const player = ref(null)
const fallback = ref(false)
const assessment = shallowRef(null)
const recording = computed(() => recordingFor(props.conversation, assessment.value))
async function showEvidence(range) {
  const turns = props.conversation.transcript
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) ||
      range.start < 0 || range.end < range.start || range.end >= turns.length) return
  activeRange.value = range
  await nextTick()
  transcript.value?.children[range.start]?.focus()
  const spans = recording.value.turns.filter(t => t.index >= range.start && t.index <= range.end)
  if (spans.length) player.value?.selectRange(spans[0].start, spans.at(-1).end)
  const offset = turns[range.start].startMs
  if (audio.value && offset != null && offset !== '' && Number.isFinite(Number(offset)) && Number(offset) >= 0) {
    audio.value.currentTime = Number(offset) / 1000
  }
}
</script>

<template>
  <h1>{{ conversation.externalId }}</h1>
  <p class="meta">{{ conversation.language }} · {{ conversation.channel }}</p>
  <section v-if="recording.audioUrl" aria-label="Аудиозапись звонка">
    <h2>Запись звонка</h2>
    <AudioReview v-if="!fallback" ref="player" :recording="recording" @unavailable="fallback = true" />
    <template v-else>
      <p role="status">Не удалось загрузить волну записи.</p>
      <button type="button" @click="fallback = false">Повторить загрузку</button>
      <audio ref="audio" :src="recording.audioUrl" controls preload="metadata" aria-label="Запись звонка"></audio>
      <a :href="conversation.audioUrl" target="_blank" rel="noopener noreferrer">Открыть исходную запись</a>
    </template>
  </section>
  <p v-else>{{ conversation.channel === 'agent chat' ? 'Текстовый чат. Аудиозаписи нет.' : 'Для этого диалога нет ссылки на аудиозапись.' }}
    <RouterLink :to="{ name: 'conversations', query: { channel: 'voice call' } }">Перейти к голосовым звонкам</RouterLink>
  </p>
  <h2>Транскрипт</h2>
  <ol ref="transcript" class="transcript">
    <li v-for="(turn, index) in conversation.transcript" :id="`turn-${index + 1}`" :key="index" tabindex="-1">
      <strong>{{ turn.speaker }}</strong> <span>{{ turn.timestamp }}</span>
      <p><mark v-if="activeRange && index >= activeRange.start && index <= activeRange.end">{{ turn.text }}</mark><template v-else>{{ turn.text }}</template></p>
    </li>
  </ol>
  <EvaluationPanel :key="conversation.id" :conversation-id="conversation.id" :service="service" @result="assessment = $event" @evidence="showEvidence" />
</template>
