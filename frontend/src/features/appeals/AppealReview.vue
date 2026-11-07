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
  <article class="appeal-card">
    <header><h1>{{ card.criterion.name }}</h1>
    <p class="appeal-meta"><span>{{ card.conversation.externalId }}</span><span class="status" :data-status="card.status">{{ statusLabel(card.status) }}</span></p></header>
    <section class="appeal-section"><h2>Комментарий заявителя</h2><p>{{ card.comment }}</p></section>
    <section class="appeal-section"><h2>Оценка критерия</h2>
    <p>Исходный ответ: {{ answerLabel(card.originalResult.answer) }}</p>
    <p>{{ card.originalResult.explanation }}</p>
    <blockquote v-for="(e, i) in card.originalResult.evidence" :key="i">Реплика {{ e.turnIndex + 1 }} · {{ e.quote }}</blockquote>
    <p v-if="card.originalResult.checkedRange">Проверенный участок: {{ card.originalResult.checkedRange.start + 1 }}–{{ card.originalResult.checkedRange.end + 1 }}</p>
    <details class="appeal-transcript"><summary>Транскрипт</summary><ol><li v-for="(turn, i) in card.conversation.transcript" :key="i">{{ turn.speaker }} · {{ turn.text }}</li></ol></details></section>
    <div class="score-comparison"><p>Исходный итог: <strong>{{ card.originalScore?.total ?? 'не рассчитан' }}</strong></p><p>Текущий итог: <strong>{{ card.finalScore?.total ?? 'не рассчитан' }}</strong></p></div>
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

<style scoped>
.appeal-card { max-width:1000px; color:#263952 }
.appeal-card header { margin:13px 0 22px }
.appeal-card h1 { margin:0; font-size:clamp(24px,3vw,33px); letter-spacing:-.035em }
.appeal-meta { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:7px 0 0; color:#607188; font-size:14px }
.status { border-radius:20px; background:#edf2f8; color:#53657b; padding:4px 10px; font-size:12px; font-weight:600 }
.status[data-status=PENDING]{background:#fff4d8;color:#896210}
.status[data-status=ACCEPTED]{background:#e5f6ef;color:#197353}
.appeal-section,.appeal-card form fieldset { min-width:0; margin:0 0 12px; padding:18px 20px; background:#fff; border:1px solid #dce3ec; border-radius:8px }
.appeal-section h2, .appeal-card legend { margin:0 0 10px; font-size:17px; font-weight:650 }
.appeal-section p { margin:8px 0; overflow-wrap:anywhere; line-height:1.5 }
.appeal-section blockquote { margin:10px 0; padding:10px 14px; border-left:3px solid #70a6ef; background:#f3f7fc; border-radius:0 5px 5px 0; overflow-wrap:anywhere }
.appeal-transcript { padding-top:10px; border-top:1px solid #e4eaf1; margin-top:14px }
.appeal-transcript summary { color:#175ca8; cursor:pointer; font-weight:600; font-size:14px }
.appeal-transcript ol { padding-left:24px; max-height:360px; overflow:auto; line-height:1.5; overflow-wrap:anywhere }
.appeal-transcript li { padding:5px 0 }
.score-comparison { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin:14px 0 18px }
.score-comparison p { display:grid; gap:5px; margin:0; padding:14px 18px; border-radius:8px; background:#fff; border:1px solid #dce3ec; color:#52647a; font-size:13px }
.score-comparison strong { font-size:24px; color:#215eaa; line-height:1.3; letter-spacing:-.025em }
.appeal-card form fieldset { display:grid; gap:13px }
.appeal-card legend { background:white; padding:0 6px }
.appeal-card label { max-width:650px; display:grid; gap:6px; font-size:13px; color:#40546c; font-weight:600 }
.appeal-card form button { justify-self:start; background:#1768d5; color:#fff; border-color:#1768d5 }
</style>
