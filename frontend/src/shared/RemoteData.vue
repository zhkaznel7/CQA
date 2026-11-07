<script setup>
import { ref, shallowRef, watch } from 'vue'
import { getJson } from './api.js'

const props = defineProps({ path: { type: String, required: true } })
const payload = shallowRef(null)
const error = ref('')
const attempt = ref(0)

watch([() => props.path, attempt], async ([path], _, onCleanup) => {
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  payload.value = null
  error.value = ''
  try {
    const result = await getJson(path, controller.signal)
    if (!controller.signal.aborted) payload.value = result
  } catch (cause) {
    if (!controller.signal.aborted) {
      error.value = cause instanceof TypeError ? 'Нет соединения с сервером.' : cause.message
    }
  }
}, { immediate: true })
</script>

<template>
  <div v-if="error" role="alert">
    <p>{{ error }}</p>
    <button type="button" @click="attempt++">Повторить</button>
  </div>
  <p v-else-if="payload === null" role="status">Загрузка…</p>
  <slot v-else :payload="payload" />
</template>
