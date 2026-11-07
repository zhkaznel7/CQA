<script setup>
import { computed, ref, watch } from 'vue'
import WaveformPlayer from './WaveformPlayer.vue'

const props = defineProps({ recording: { type: Object, required: true } })
defineEmits(['unavailable'])
function selectRange(start, end) { selection.value = { start, end } }
defineExpose({ selectRange })
const selection = ref({ start: 0, end: 0 })
watch(() => props.recording.audioUrl, () => {
  const recording = props.recording
  const first = recording.findings[0] ?? recording.turns[0]
  selection.value = { start: first?.start ?? 0, end: first?.end ?? 1 }
}, { immediate: true })

function overlaps(item) {
  return item.start < selection.value.end && item.end > selection.value.start
}

const excerpt = computed(() => props.recording.turns.filter(overlaps).map(turn => {
  const words = turn.words?.filter(overlaps)
  return {
    turn,
    text: words ? words.map(word => word.text).join(' ') : turn.text,
    wholeTurn: !words,
  }
}).filter(row => row.text))

const findings = computed(() => props.recording.findings.filter(overlaps))
</script>

<template>
  <section class="audio-review" aria-label="Разбор аудиозаписи">
    <WaveformPlayer :key="recording.audioUrl" :src="recording.audioUrl"
      :selection="selection" @select="selection = $event" @unavailable="$emit('unavailable')" />
    <p v-if="!recording.turns.length">В транскрипте нет таймкодов относительно записи. Выделенный фрагмент можно прослушать.</p>
    <template v-else>
      <h2>Слова в выделении</h2>
      <ul v-if="excerpt.length" class="audio-excerpt">
        <li v-for="row in excerpt" :key="row.turn.start">
          <strong>{{ row.turn.speaker }}</strong> — {{ row.text }}
          <small v-if="row.wholeTurn">(реплика целиком, нет меток слов)</small>
        </li>
      </ul>
      <p v-else>В этом диапазоне нет размеченных слов.</p>
      <h2>Выводы анализатора в выделении</h2>
      <ul v-if="findings.length" class="audio-findings">
        <li v-for="finding in findings" :key="finding.id">
          <strong>{{ finding.criterion }}</strong> — {{ finding.explanation }}
          <button type="button" @click="selection = { start: finding.start, end: finding.end }">
            Выделить основание
          </button>
        </li>
      </ul>
      <p v-else>К этому диапазону замечания не привязаны.</p>
    </template>
  </section>
</template>
