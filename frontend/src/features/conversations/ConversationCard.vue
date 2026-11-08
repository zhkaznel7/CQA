<script setup>
import { computed, nextTick, ref, shallowRef } from 'vue'
import EvaluationPanel from '../evaluations/EvaluationPanel.vue'
import AppIcon from '../../shared/AppIcon.vue'
import { channelIcon, channelName, dateLabel, groupName, languageName, speakerName, timeLabel } from './conversation-labels.js'
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
  <div class="dialog-card">
    <header class="dialog-heading">
      <span class="dialog-symbol" :class="{ 'is-call': channelIcon(conversation.channel) === 'phone' }"><AppIcon :name="channelIcon(conversation.channel)" /></span>
      <div>
        <h1>{{ conversation.externalId }}</h1>
        <div class="dialog-meta">
          <span>{{ channelName(conversation.channel) }}</span>
          <span>{{ languageName(conversation.language) }}</span>
          <span v-if="conversation.groupId">{{ groupName(conversation.groupId) }}</span>
          <span v-if="conversation.createdAt">Добавлен {{ dateLabel(conversation.createdAt) }}</span>
        </div>
      </div>
    </header>

    <section v-if="recording.audioUrl" class="dialog-audio dialog-surface" aria-label="Аудиозапись звонка">
      <h2><AppIcon name="phone" />Запись звонка</h2>
      <AudioReview v-if="!fallback" ref="player" :recording="recording" @unavailable="fallback = true" />
      <template v-else>
        <p role="status">Не удалось загрузить волну записи.</p>
        <button type="button" @click="fallback = false">Повторить загрузку</button>
        <audio ref="audio" :src="recording.audioUrl" controls preload="metadata" aria-label="Запись звонка"></audio>
        <a :href="conversation.audioUrl" target="_blank" rel="noopener noreferrer">Открыть исходную запись</a>
      </template>
    </section>
    <p v-else class="dialog-audio-note"><AppIcon name="chat" />
      <span>{{ conversation.channel === 'agent chat' ? 'Текстовый чат. Аудиозаписи нет.' : 'Для этого диалога нет ссылки на аудиозапись.' }}</span>
      <RouterLink :to="{ name: 'conversations', query: { channel: 'voice call' } }">Перейти к голосовым звонкам</RouterLink>
    </p>

    <div class="dialog-workspace">
      <section class="dialog-surface transcript-pane" aria-label="Транскрипт разговора">
        <header class="transcript-heading"><h2><AppIcon name="chat" />Транскрипт</h2><span>{{ conversation.transcript.length }} репл.</span></header>
        <ol ref="transcript" class="transcript">
          <li v-for="(turn, index) in conversation.transcript" :id="`turn-${index + 1}`" :key="index" tabindex="-1"
            :class="['turn-' + turn.speaker, { 'is-evidence': activeRange && index >= activeRange.start && index <= activeRange.end }]">
            <span class="turn-avatar" aria-hidden="true">{{ speakerName(turn.speaker)?.slice(0, 1).toUpperCase() }}</span>
            <div class="turn-meta"><strong>{{ speakerName(turn.speaker) }}</strong><span>#{{ index + 1 }}</span><time :title="String(turn.timestamp ?? '')">{{ timeLabel(turn.timestamp) }}</time></div>
            <p><mark v-if="activeRange && index >= activeRange.start && index <= activeRange.end">{{ turn.text }}</mark><template v-else>{{ turn.text }}</template></p>
          </li>
        </ol>
      </section>
      <EvaluationPanel class="dialog-surface dialog-evaluation" :key="conversation.id" :conversation-id="conversation.id" :service="service" @result="assessment = $event" @evidence="showEvidence" />
    </div>
  </div>
</template>

<style scoped src="./conversation-card.css"></style>
