<script setup>
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getJson, postJson, putJson } from '../../shared/api.js'
import ChecklistEditor from './ChecklistEditor.vue'
import { newChecklist } from './checklist.js'

const props = defineProps({ id: String })
const router = useRouter()
const source = shallowRef(null)
const saving = ref(false)
const error = ref('')
const message = ref('')
const attempt = ref(0)
let saveController

watch([() => props.id, attempt], async ([id], _, onCleanup) => {
  const controller = new AbortController()
  saveController?.abort()
  saveController = null
  saving.value = false
  onCleanup(() => controller.abort())
  source.value = null
  error.value = ''
  try {
    const data = id
      ? (await getJson('/checklists/' + encodeURIComponent(id), controller.signal)).data
      : newChecklist()
    if (!controller.signal.aborted) source.value = data
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause.message
  }
}, { immediate: true })

async function save(body) {
  if (saving.value) return
  const controller = new AbortController()
  saveController = controller
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    let saved
    if (props.id) saved = (await putJson('/checklists/' + encodeURIComponent(props.id), body, controller.signal)).data
    else saved = (await postJson('/checklists', body, controller.signal)).data
    if (controller.signal.aborted) return
    source.value = saved
    message.value = 'Сохранена версия ' + saved.version + '.'
    await router.replace({ name: 'checklist-editor', params: { id: saved.id } })
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause.code === 'STALE_CHECKLIST_VERSION'
      ? 'Уже есть более новая версия. Откройте её из списка чек-листов и перенесите свои изменения.'
      : cause.message
  } finally {
    if (saveController === controller) saving.value = false
  }
}
onBeforeUnmount(() => saveController?.abort())
</script>

<template>
  <RouterLink :to="{ name: 'checklists' }">К списку чек-листов</RouterLink>
  <h1>Редактор чек-листа</h1>
  <p v-if="error" role="alert">{{ error }}</p>
  <p v-if="message" role="status">{{ message }}</p>
  <ChecklistEditor v-if="source" :key="source.id ?? 'new'" :source="source" :saving="saving" @save="save" />
  <button v-else-if="error" type="button" @click="attempt++">Повторить загрузку</button>
  <p v-else>Загрузка…</p>
</template>
