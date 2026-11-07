<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { postJson } from '../../shared/api.js'
const props = defineProps({ evaluationId: String, criterionId: String })
const open = ref(false)
const comment = ref('')
const busy = ref(false)
const error = ref('')
const createdId = ref('')
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())
async function submit() {
  if (busy.value || !comment.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    const { data } = await postJson('/appeals', {
      evaluationId: props.evaluationId, criterionId: props.criterionId, comment: comment.value.trim(),
    }, controller.signal)
    createdId.value = data.id
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause.code === 'APPEAL_ALREADY_PENDING'
      ? 'По этому критерию уже есть обращение в разделе «Апелляции».' : cause.message
  } finally { busy.value = false }
}
</script>

<template>
  <RouterLink v-if="createdId" :to="{ name: 'appeal', params: { id: createdId } }">Открыть обращение</RouterLink>
  <button v-else-if="!open" type="button" @click="open = true">Оспорить</button>
  <form v-else @submit.prevent="submit">
    <label>Комментарий к оценке <textarea v-model="comment" required maxlength="4000"></textarea></label>
    <button type="submit" :disabled="busy">Подать апелляцию</button>
    <button type="button" :disabled="busy" @click="open = false">Отмена</button>
    <p v-if="error" role="alert">{{ error }}</p>
  </form>
</template>
