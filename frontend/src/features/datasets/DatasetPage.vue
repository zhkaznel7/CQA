<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { getJson, postJson } from '../../shared/api.js'
import { fetchDialogs } from '../conversations/conversation-catalog.js'
import { evaluationService } from '../evaluations/service.js'
import DatasetImport from './DatasetImport.vue'

const group = ref('DEV')
const versions = ref([])
const checklistId = ref('')
const versionError = ref('')
const team = ref('')
const action = ref('')
const busy = computed(() => Boolean(action.value))
const stop = ref(false)
const state = reactive({ completed: 0, total: 0, failures: [] })
const message = ref('')
const error = ref('')
const signal = new AbortController()
const dataset = computed(() => group.value === 'DEV' ? 'dev' : 'prod')
const validGroup = computed(() => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(group.value))

async function loadVersions() {
  versionError.value = ''
  try {
    versions.value = await evaluationService.listVersions(signal.signal)
    const official = versions.value.find(v => v.key === 'freedom-broker-chat-quality' && v.version === 1)
    checklistId.value = (official ?? versions.value[0])?.id ?? ''
  } catch (cause) {
    if (!signal.signal.aborted) versionError.value = cause.message
  }
}

function start(which) {
  if (busy.value || !validGroup.value || !checklistId.value) return false
  action.value = which
  error.value = ''
  message.value = ''
  stop.value = false
  Object.assign(state, { completed: 0, total: 0, failures: [] })
  return true
}

async function evaluateGroup() {
  if (!start('evaluate')) return
  try {
    const records = await fetchDialogs(signal.signal, '', group.value)
    if (!records.length) throw new Error('В этой группе пока нет диалогов. Загрузите набор или проверьте идентификатор группы.')
    state.total = records.length
    for (const item of records) {
      if (stop.value || signal.signal.aborted) break
      try {
        await postJson('/evaluations', { conversationId: item.id, checklistId: checklistId.value }, signal.signal)
      } catch (cause) {
        if (signal.signal.aborted) break
        state.failures.push({ id: item.id, externalId: item.externalId, message: cause.message })
      }
      state.completed++
    }
    const prefix = stop.value ? 'Остановлено.' : 'Обработка завершена.'
    message.value = prefix + ' Группа ' + group.value + ' · Оценено ' + (state.completed - state.failures.length) + ' из ' + state.total + '. Ошибок ' + state.failures.length + '.'
  } catch (cause) {
    if (!signal.signal.aborted) error.value = cause.message
  } finally { action.value = '' }
}

async function downloadResults() {
  if (!start('download')) return
  try {
    const query = new URLSearchParams({
      group_id: group.value, checklistId: checklistId.value, team: team.value,
    })
    const output = await getJson('/exports/' + dataset.value + '?' + query, signal.signal)
    const failed = output.results.filter(item => item.status === 'error').length
    const blob = new Blob([JSON.stringify(output, null, 2) + '\n'], { type: 'application/json;charset=utf-8' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'results.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    message.value = 'Файл для results/' + dataset.value + '/results.json готов. Записей ' + output.results.length + ', из них с ошибкой ' + failed + '.'
  } catch (cause) {
    if (!signal.signal.aborted) error.value = cause.message
  } finally { action.value = '' }
}
onMounted(loadVersions)
onBeforeUnmount(() => signal.abort())
</script>

<template>
  <div class="datasets">
    <header><h1>Наборы данных</h1><p>Импорт диалогов и подготовка результатов для организаторов.</p></header>
    <DatasetImport @imported="id => { if (!busy) group = id }" />
    <section class="dataset-panel">
      <h2>Оценка набора</h2>
      <form @submit.prevent="evaluateGroup">
        <fieldset :disabled="busy">
          <label>Идентификатор группы<input v-model.trim="group" required maxlength="200" placeholder="DEV" pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" /></label>
          <label>Версия чек-листа<select v-model="checklistId" required>
            <option v-if="!versions.length" value="" disabled>Нет доступных версий</option>
            <option v-for="v in versions" :key="v.id" :value="v.id">{{ v.name }} · v{{ v.version }}</option>
          </select></label>
          <button type="submit" :disabled="!checklistId">Оценить группу</button>
        </fieldset>
      </form>
      <p v-if="versionError" role="alert">{{ versionError }} <button @click="loadVersions">Повторить загрузку версий</button></p>
      <p class="dataset-hint">Каждый диалог оценивается по выбранной версии. Уже сохранённые оценки используются повторно. Оставьте страницу открытой до окончания обработки.</p>
      <div v-if="action === 'evaluate'" role="status" class="batch-progress">
        <progress :value="state.completed" :max="state.total || 1"></progress>
        {{ state.completed }} / {{ state.total }}
        <button type="button" :disabled="stop" @click="stop = true">{{ stop ? 'Остановка…' : 'Остановить после текущего' }}</button>
      </div>
      <ul v-if="state.failures.length" class="batch-errors">
        <li v-for="failure in state.failures" :key="failure.id"><RouterLink :to="{ name: 'conversation', params: { id: failure.id } }">{{ failure.externalId }}</RouterLink> · {{ failure.message }}</li>
      </ul>
    </section>
    <section class="dataset-panel">
      <h2>Выгрузка результатов</h2>
      <p class="dataset-hint">Исходные оценки модели по выбранному чек-листу для группы {{ group || '…' }}. В файл JSON версии 1.0 попадут все диалоги набора. У диалогов без оценки будет статус error.</p>
      <form @submit.prevent="downloadResults">
        <fieldset :disabled="busy">
          <label>Команда<input v-model.trim="team" required /></label>
          <button type="submit" :disabled="!validGroup || !checklistId">{{ action === 'download' ? 'Подготовка…' : 'Скачать JSON' }}</button>
        </fieldset>
      </form>
    </section>
    <p v-if="message" role="status" class="dataset-report">{{ message }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style>
.datasets { display: grid; gap: 16px; max-width: 1120px; }
.datasets h1 { margin: 0 0 5px; font-size: clamp(26px,3vw,34px); letter-spacing: -.04em; }
.datasets header p, .dataset-hint { color: #586b82; font-size: 14px; line-height: 1.55; margin: 0; }
.dataset-panel { padding: clamp(16px,2vw,24px); background: white; border-radius: 10px; border: 1px solid #dce3ec; }
.dataset-panel h2 { margin: 0 0 14px; font-size: 19px; letter-spacing: -.02em; }
.dataset-panel fieldset { padding: 0; border: 0; margin: 0; display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
.dataset-panel label { display: grid; gap: 5px; min-width: 0; flex: 1 1 175px; font-size: 13px; font-weight: 600; color: #40546c; }
.dataset-panel label input, .dataset-panel label select { width: 100%; min-width: 0; }
.dataset-panel button[type=submit] { background: #1768d5; color: white; border-color: #1768d5; }
.dataset-panel button:disabled { opacity: .55; }
.dataset-panel .dataset-hint { margin: 12px 0; }
.dataset-panel p:last-child { margin-bottom: 0; }
.dataset-report { background: #eaf4ff; padding: 12px 16px; border-radius: 7px; }
.batch-progress { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.batch-errors { max-height: 220px; overflow: auto; color: #78421a; font-size: 13px; }
@media (max-width: 560px) {
  .dataset-panel fieldset { align-items: stretch; flex-direction: column; }
  .dataset-panel label { flex-basis: auto; }
}
</style>
