<script setup>
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { getJson, patchJson } from '../../shared/api.js'
import { statusLabel, answerLabel } from './appeals.js'

const props = defineProps({ initial: { type: Object, required: true } })
const card = shallowRef(props.initial)
const decision = ref('CONFIRM')
const replacement = ref('')
const reason = ref('')
const naReason = ref('')
const busy = ref(false)
const error = ref('')
const controller = new AbortController()
onBeforeUnmount(() => controller.abort())

const criterion = computed(() => card.value.checklist.criteria.find(c => c.key === card.value.criterion.key))
const values = computed(() => criterion.value?.type === 'scale'
  ? criterion.value.scaleSteps.map(s => ({ value: s.value, label: s.label + ' (' + s.value + ')' }))
  : [{ value: true, label: 'Да' }, { value: false, label: 'Нет' }])

async function save() {
  if (busy.value || !reason.value.trim()) return
  const body = { decision: decision.value, reason: reason.value.trim() }
  if (body.decision === 'CHANGE') {
    if (replacement.value === '') return
    if (replacement.value === 'na') {
      if (!naReason.value.trim()) return
      Object.assign(body, { isNa: true, naReason: naReason.value.trim() })
    } else body.value = replacement.value
  }
  const url = '/appeals/' + encodeURIComponent(card.value.id)
  busy.value = true
  error.value = ''
  try {
    card.value = (await patchJson(url + '/decision', body, controller.signal)).data
  } catch (cause) {
    if (controller.signal.aborted) return
    error.value = cause.message
    if (cause.code === 'APPEAL_ALREADY_DECIDED') {
      try { card.value = (await getJson(url, controller.signal)).data }
      catch (reloadError) { error.value = reloadError.message }
    }
  } finally { busy.value = false }
}
</script>

<template>
  <article>
    <h1>{{ card.criterion.name }}</h1>
    <p>{{ card.conversation.externalId }} · {{ statusLabel(card.status) }}</p>
    <p>Комментарий заявителя: {{ card.comment }}</p>
    <p>Исходный ответ: {{ answerLabel(card.originalResult.answer) }}</p>
    <p>{{ card.originalResult.explanation }}</p>
    <blockquote v-for="(e, i) in card.originalResult.evidence" :key="i">Реплика {{ e.turnIndex + 1 }} · {{ e.quote }}</blockquote>
    <p v-if="card.originalResult.checkedRange">Проверенный участок: {{ card.originalResult.checkedRange.start + 1 }}–{{ card.originalResult.checkedRange.end + 1 }}</p>
    <details><summary>Транскрипт</summary><ol><li v-for="(turn, i) in card.conversation.transcript" :key="i">{{ turn.speaker }} · {{ turn.text }}</li></ol></details>
    <p>Исходный итог: {{ card.originalScore?.total ?? 'не рассчитан' }} · Текущий итог: {{ card.finalScore?.total ?? 'не рассчитан' }}</p>
    <p v-if="card.decision">Причина решения: {{ card.reason }} · Проверяющий: {{ card.reviewer }}</p>
    <p v-if="card.decision === 'CHANGE'">Ответ после пересмотра: {{ answerLabel(card.revisedAnswer) }} {{ card.revisedNaReason }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <form v-if="card.status === 'PENDING' && card.reviewable && criterion" @submit.prevent="save">
      <fieldset :disabled="busy"><legend>Решение проверяющего</legend>
        <label>Действие <select v-model="decision"><option value="CONFIRM">Подтвердить оценку</option><option value="CHANGE">Изменить оценку</option></select></label>
        <label v-if="decision === 'CHANGE'">Новый ответ <select v-model="replacement" required>
          <option disabled value="">Выберите ответ</option>
          <option v-for="opt in values" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</option>
          <option v-if="criterion.allowNa && criterion.type !== 'flag'" value="na">N/A</option>
        </select></label>
        <label v-if="decision === 'CHANGE' && replacement === 'na'">Причина N/A <textarea v-model="naReason" required maxlength="5000"></textarea></label>
        <label>Причина решения <textarea v-model="reason" required maxlength="4000"></textarea></label>
        <button type="submit">Сохранить решение</button>
      </fieldset>
    </form>
    <p v-else-if="card.status === 'PENDING'">Пересмотр недоступен: {{ card.reviewError ?? 'Критерий отсутствует в версии чек-листа.' }}</p>
  </article>
</template>
