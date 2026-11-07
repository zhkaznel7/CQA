<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'

const props = defineProps({
  src: { type: String, required: true },
  selection: { type: Object, required: true },
})
const emit = defineEmits(['select'])
const container = ref(null)
const duration = ref(0)
const playing = ref(false)
const error = ref('')
let player
let activeRegion

function select(start, end) {
  start = Math.max(0, Math.min(start, duration.value))
  end = Math.max(0, Math.min(end, duration.value))
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    emit('select', { start, end })
  }
}

function editBoundary(event, side) {
  const value = event.target.valueAsNumber
  const { start, end } = props.selection
  if (side === 'start') select(value, end)
  else select(start, value)
  // При ошибке ввода возвращаем в поле последнее допустимое значение.
  event.target.value = props.selection[side].toFixed(3)
}

function syncRegion(region) {
  if (region === activeRegion) select(region.start, region.end)
}

onMounted(() => {
  player = WaveSurfer.create({
    container: container.value, height: 80, interact: false,
    waveColor: '#838383', progressColor: '#353535',
  })
  const regions = player.registerPlugin(RegionsPlugin.create())
  const options = { color: 'rgba(50, 105, 210, 0.22)', minLength: 0.05 }
  regions.on('region-created', region => {
    if (activeRegion !== region) activeRegion?.remove()
    activeRegion = region
    syncRegion(region)
  })
  regions.on('region-update', syncRegion)
  regions.on('region-updated', syncRegion)
  player.on('play', () => { playing.value = true })
  player.on('pause', () => { playing.value = false })
  player.on('finish', () => { playing.value = false })
  player.on('error', () => { error.value = 'Не удалось открыть аудиозапись.' })
  player.on('ready', seconds => {
    duration.value = seconds
    const start = props.selection.start < seconds ? props.selection.start : 0
    const end = Math.min(seconds, props.selection.end)
    regions.addRegion({ ...options, start, end: end > start ? end : seconds })
    regions.enableDragSelection(options)
  })
  player.load(props.src).catch(cause => {
    if (cause.name !== 'AbortError') error.value = 'Не удалось загрузить волну аудиозаписи.'
  })
})

watch(() => props.selection, ({ start, end }) => {
  if (!activeRegion) return
  if (player.isPlaying()) player.pause()
  if (activeRegion.start !== start || activeRegion.end !== end) {
    activeRegion.setOptions({ start, end })
  }
})

async function playSelection() {
  if (playing.value) {
    player.pause()
    return
  }
  try {
    await player.play(props.selection.start, props.selection.end)
  } catch (cause) {
    if (cause.name !== 'AbortError') error.value = 'Не удалось воспроизвести фрагмент.'
  }
}

onBeforeUnmount(() => { player?.destroy() })
</script>

<template>
  <p>Протяните по волне для выбора фрагмента. Края выделения можно двигать, а границы — вводить в секундах.</p>
  <div ref="container" class="waveform"></div>
  <p v-if="error" role="alert">{{ error }}</p>
  <p v-else-if="!duration" role="status">Загрузка записи…</p>
  <fieldset :disabled="!duration">
    <legend>Фрагмент записи<span v-if="duration"> · всего {{ duration.toFixed(2) }} с</span></legend>
    <label>Начало, с
      <input type="number" min="0" :max="selection.end" step="0.001"
        :value="selection.start.toFixed(3)" @change="editBoundary($event, 'start')">
    </label>
    <label>Конец, с
      <input type="number" :min="selection.start" :max="duration" step="0.001"
        :value="selection.end.toFixed(3)" @change="editBoundary($event, 'end')">
    </label>
    <button type="button" @click="playSelection">{{ playing ? 'Пауза' : 'Прослушать выделение' }}</button>
    <button type="button" @click="select(0, duration)">Вся запись</button>
  </fieldset>
</template>
