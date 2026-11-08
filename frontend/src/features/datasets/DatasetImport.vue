<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { postJson } from '../../shared/api.js'

const emit = defineEmits(['imported'])
const source = ref('api')
const group = ref('DEV')
const file = ref(null)
const busy = ref(false)
const report = ref(null)
const error = ref('')
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())

async function importDataset() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  report.value = null
  try {
    let response
    if (source.value === 'api') {
      response = await postJson('/conversations/import', { group_id: group.value.trim() }, controller.signal)
    } else {
      let body
      try {
        body = JSON.parse((await file.value.text()).replace(/^\uFEFF/, ''))
      } catch {
        throw new Error('Не удалось прочитать JSON. Выберите файл с исходным ответом API.')
      }
      response = await postJson('/conversations/upload', body, controller.signal)
    }
    report.value = response.data
    emit('imported', response.data.groupId)
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="dataset-panel">
    <h2>Загрузка диалогов</h2>
    <form @submit.prevent="importDataset">
      <fieldset :disabled="busy">
        <label>Источник
          <select v-model="source"><option value="api">API организаторов или демонабор сервера</option><option value="file">Файл ответа API (.json)</option></select>
        </label>
        <label v-if="source === 'api'">Идентификатор группы
          <input v-model.trim="group" required maxlength="200" pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" placeholder="DEV" />
        </label>
        <label v-else>Исходный файл организаторов
          <input type="file" required accept=".json,application/json" @change="file = $event.target.files[0]" />
        </label>
        <button type="submit">{{ busy ? 'Загрузка…' : 'Загрузить диалоги' }}</button>
      </fieldset>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="report" role="status">Группа {{ report.groupId }} · Получено {{ report.received }} · Добавлено {{ report.imported }} · Повторы {{ report.duplicates }} · Некорректных {{ report.invalid }}.
      <RouterLink :to="{ name: 'conversations', query: { group_id: report.groupId } }">Открыть диалоги</RouterLink>
    </p>
  </section>
</template>
