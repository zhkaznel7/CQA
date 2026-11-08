<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import AppealRequest from '../appeals/AppealRequest.vue'
import { evaluationService } from './service.js'

const props = defineProps({
  conversationId: { type: String, required: true },
  service: { type: Object, default: () => evaluationService },
})
const emit = defineEmits(['evidence', 'result'])
const versions = shallowRef([])
const selected = ref('')
const result = shallowRef(null)
const busy = ref(false)
const error = ref('')
const controller = new AbortController()

function evaluationError(cause) {
  const keys = cause.details?.map(item => item.criterionKey).filter(Boolean).join(', ')
  if (cause.code === 'AI_NA_UNCONFIRMED') {
    return 'Модель выбрала N/A' + (keys ? ' по критериям ' + keys : '') +
      '. Проверяющему нужно подтвердить условие по исходному диалогу для этой версии чек-листа. Оценка не сохранена.'
  }
  if (cause.code === 'AI_INVALID_EVIDENCE') {
    return 'Цитата модели' + (keys ? ' по критерию ' + keys : '') +
      ' не соответствует реплике или проверенному диапазону. Оценка не сохранена.'
  }
  return cause.message
}

async function run(action) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    if (!controller.signal.aborted) error.value = evaluationError(cause)
  } finally {
    busy.value = false
  }
}

function loadVersions() {
  return run(async () => {
    versions.value = await props.service.listVersions(controller.signal)
    selected.value = versions.value[0]?.id ?? ''
  })
}

function evaluate() {
  return run(async () => {
    result.value = null
    emit('result', null)
    result.value = await props.service.evaluate(props.conversationId, selected.value, controller.signal)
    emit('result', result.value)
  })
}

const hasScore = computed(() => {
  const evaluation = result.value?.evaluation
  return evaluation?.score && Array.isArray(evaluation.score.criteria)
    && Array.isArray(evaluation.score.sections) && Array.isArray(evaluation.results)
    && Array.isArray(result.value.checklist?.criteria)
})

const rows = computed(() => {
  if (!hasScore.value) return []
  const { evaluation, checklist } = result.value
  const names = new Map(checklist.criteria.map(c => [c.key, c.name]))
  const scores = new Map(evaluation.score.criteria.map(c => [c.key, c]))
  const current = new Map(result.value.currentScore?.criteria.map(c => [c.key, c]))
  return evaluation.results.map(row => ({
    ...row, name: names.get(row.criterionKey) ?? row.criterionKey, score: scores.get(row.criterionKey),
    current: current.get(row.criterionKey),
  }))
})

const sections = computed(() => {
  if (!hasScore.value) return []
  const current = new Map(result.value.currentScore?.sections.map(s => [s.key, s]))
  return result.value.evaluation.score.sections.map(s => ({ ...s, current: current.get(s.key) }))
})

function total(score) {
  return score.total == null ? 'не рассчитан' : points.format(score.total) + ' / 100'
}

function answer(value, isNa) {
  if (isNa) return 'N/A'
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет'
  return value
}

const points = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 })
onMounted(loadVersions)
onBeforeUnmount(() => controller.abort())
</script>

<template>
  <section class="evaluation-panel" aria-label="Оценка диалога">
    <h2>Оценка диалога</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">{{ versions.length ? 'Получаем оценку…' : 'Загружаем чек-листы…' }}</p>
    <div v-if="versions.length" class="evaluation-toolbar">
      <label>Версия чек-листа
        <select v-model="selected" :disabled="busy" @change="result = null; emit('result', null)">
          <option v-for="v in versions" :key="v.id" :value="v.id">{{ v.name }} · v{{ v.version }}</option>
        </select>
      </label>
      <button type="button" :disabled="busy" @click="evaluate">Оценить</button>
    </div>
    <template v-else-if="!busy">
      <p v-if="!error">Нет доступных версий чек-листа.</p>
      <button type="button" @click="loadVersions">Обновить список</button>
    </template>
    <p v-if="result && !hasScore" role="alert">Сохранённая оценка имеет несовместимый формат или не содержит баллов. Исходная оценка не изменена. Выберите другую версию чек-листа.</p>
    <article v-if="result && hasScore">
      <h3>Результат · {{ result.checklist.name }} · v{{ result.checklist.version }}</h3>
      <p v-if="result.evaluation.isMock">Оценка тестовой модели сервера</p>
      <p v-if="result.reused">Получена ранее сохранённая оценка.</p>
      <p v-if="result.reviewError" role="alert">Не удалось получить действующую оценку. {{ result.reviewError }} Нажмите «Оценить», чтобы повторить.</p>
      <div class="score-table"><table>
        <caption>Сводка оценки</caption>
        <thead><tr><th scope="col">Показатель</th><th scope="col">Исходная оценка модели</th><th scope="col">Действующая оценка с учётом апелляций</th></tr></thead>
        <tbody>
          <tr><th scope="row">Итог</th><td>{{ total(result.evaluation.score) }}</td><td>{{ result.currentScore ? total(result.currentScore) : 'Нет данных' }}</td></tr>
          <tr><th scope="row">Грубая ошибка</th><td>{{ result.evaluation.score.grossError ? 'Да' : 'Нет' }}</td><td>{{ result.currentScore ? (result.currentScore.grossError ? 'Да' : 'Нет') : 'Нет данных' }}</td></tr>
          <tr v-for="s in sections" :key="s.key"><th scope="row">{{ s.name }}</th>
            <td>{{ points.format(s.points) }} / {{ points.format(s.maxPoints) }}</td>
            <td>{{ s.current ? points.format(s.current.points) + ' / ' + points.format(s.current.maxPoints) : 'Нет данных' }}</td>
          </tr>
        </tbody>
      </table></div>
      <ol class="criterion-results">
        <li v-for="row in rows" :key="row.criterionId">
          <strong>{{ row.criterionKey }} · {{ row.name }}</strong>
          <span v-if="row.score && row.score.type !== 'flag'"> · вес {{ row.score.weight }}</span>
          <p>Исходный ответ модели: {{ answer(row.answer, row.isNa) }}<template v-if="row.score && row.score.type !== 'flag' && !row.isNa"> · баллы {{ points.format(row.score.points) }}</template></p>
          <p>Действующий ответ: {{ row.current ? answer(row.current.value, row.current.isNa) : 'Нет данных' }}<template v-if="row.current && row.current.type !== 'flag' && !row.current.isNa"> · баллы {{ points.format(row.current.points) }}</template></p>
          <p v-if="row.current?.isNa && row.current.naReason">Действующая причина N/A: {{ row.current.naReason }}</p>
          <p>Обоснование модели: {{ row.explanation }}</p>
          <p v-if="row.isNa && row.naReason">Исходная причина N/A: {{ row.naReason }}</p>
          <button class="evidence-link" v-for="(item, i) in row.evidence" :key="i" type="button"
            @click="emit('evidence', { start: item.turnIndex, end: item.turnIndex })">
            Реплика {{ item.turnIndex + 1 }} · «{{ item.quote }}»
          </button>
          <button class="evidence-link" v-if="row.checkedRange" type="button" @click="emit('evidence', row.checkedRange)">
            Проверенный участок: {{ row.checkedRange.start + 1 }}–{{ row.checkedRange.end + 1 }}
          </button>
          <AppealRequest :key="result.evaluation.id + row.criterionId" :evaluation-id="result.evaluation.id" :criterion-id="row.criterionId" />
        </li>
      </ol>
    </article>
  </section>
</template>

<style scoped>
.evaluation-panel { min-width:0; border:1px solid #dce3ec; border-radius:9px; padding:clamp(16px,2vw,22px); background:white; color:#263952 }
.evaluation-panel h2 { margin:0 0 16px; font-size:19px; letter-spacing:-.02em }
.evaluation-toolbar { display:flex; align-items:flex-end; flex-wrap:wrap; gap:10px }
.evaluation-toolbar label { flex:1 1 230px; max-width:490px; display:grid; gap:6px; color:#485b74; font-size:13px; font-weight:600 }
.evaluation-toolbar select { width:100%; min-width:0 }
.evaluation-toolbar button { background:#1768d5; color:white; border-color:#1768d5 }
.evaluation-panel [role=status] { display:flex; align-items:center; gap:8px; color:#536b87; font-size:13px }
.evaluation-panel [role=status]::before { content:''; width:12px; height:12px; border:2px solid #cfdded; border-top-color:#2474d7; border-radius:50%; animation:eval-spin .7s linear infinite }
@keyframes eval-spin { to {transform:rotate(360deg)} }
.evaluation-panel article { border-top:1px solid #e2e8ef; margin-top:18px; padding-top:17px }
.evaluation-panel h3 { margin:0 0 8px; font-size:16px }
.score-table { margin:14px 0; overflow:auto }
.score-table table { width:100%; border-collapse:collapse; font-size:13px; text-align:left; font-variant-numeric:tabular-nums }
.score-table th,.score-table td { padding:9px 11px; border-bottom:1px solid #e3eaf2; text-align:left; overflow-wrap:anywhere }
.score-table th { font-weight:600 }
.score-table thead th { color:#5a6b81; background:#f3f6fa; font-size:12px }
.score-table tbody tr:first-child { font-weight:700; color:#185ba5; background:#f6f9fe }
.score-table caption { text-align:left; padding:0 0 8px; font-weight:600 }
.criterion-results { list-style:none; padding:0; display:grid; gap:10px; margin:0 }
.criterion-results > li { min-width:0; padding:15px; border-radius:7px; border:1px solid #dee5ee; overflow-wrap:anywhere }
.criterion-results strong { color:#1e3552 }
.criterion-results li > span { color:#63778c; font-size:12px }
.criterion-results li > p { font-size:14px; line-height:1.5; margin:7px 0 }
.evidence-link { display:block; text-align:left; white-space:normal; margin-top:6px; padding:7px 10px; color:#195da9; border:0; border-left:2px solid #a9c9f7; border-radius:0 4px 4px 0; background:#f2f7ff; font-size:13px }
.evidence-link:hover { background:#e6effc }
@media(prefers-reduced-motion:reduce){.evaluation-panel [role=status]::before{animation:none}}
</style>
