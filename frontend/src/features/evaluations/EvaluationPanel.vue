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

const rows = computed(() => {
  if (!result.value) return []
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
  if (!result.value) return []
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
  <section aria-label="Оценка диалога">
    <h2>Оценка диалога</h2>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">{{ versions.length ? 'Получаем оценку…' : 'Загружаем чек-листы…' }}</p>
    <template v-if="versions.length">
      <label>Версия чек-листа
        <select v-model="selected" :disabled="busy" @change="result = null; emit('result', null)">
          <option v-for="v in versions" :key="v.id" :value="v.id">{{ v.name }} · v{{ v.version }}</option>
        </select>
      </label>
      <button type="button" :disabled="busy" @click="evaluate">Оценить</button>
    </template>
    <template v-else-if="!busy">
      <p v-if="!error">Нет доступных версий чек-листа.</p>
      <button type="button" @click="loadVersions">Обновить список</button>
    </template>
    <article v-if="result">
      <h3>Результат · {{ result.checklist.name }} · v{{ result.checklist.version }}</h3>
      <p v-if="result.evaluation.isMock">Оценка тестовой модели сервера</p>
      <p v-if="result.reused">Получена ранее сохранённая оценка.</p>
      <p v-if="result.reviewError" role="alert">Не удалось получить действующую оценку. {{ result.reviewError }} Нажмите «Оценить», чтобы повторить.</p>
      <table>
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
      </table>
      <ol>
        <li v-for="row in rows" :key="row.criterionId">
          <strong>{{ row.criterionKey }} · {{ row.name }}</strong>
          <span v-if="row.score && row.score.type !== 'flag'"> · вес {{ row.score.weight }}</span>
          <p>Исходный ответ модели: {{ answer(row.answer, row.isNa) }}<template v-if="row.score && row.score.type !== 'flag' && !row.isNa"> · баллы {{ points.format(row.score.points) }}</template></p>
          <p>Действующий ответ: {{ row.current ? answer(row.current.value, row.current.isNa) : 'Нет данных' }}<template v-if="row.current && row.current.type !== 'flag' && !row.current.isNa"> · баллы {{ points.format(row.current.points) }}</template></p>
          <p v-if="row.current?.isNa && row.current.naReason">Действующая причина N/A: {{ row.current.naReason }}</p>
          <p>Обоснование модели: {{ row.explanation }}</p>
          <p v-if="row.isNa && row.naReason">Исходная причина N/A: {{ row.naReason }}</p>
          <button v-for="(item, i) in row.evidence" :key="i" type="button"
            @click="emit('evidence', { start: item.turnIndex, end: item.turnIndex })">
            Реплика {{ item.turnIndex + 1 }} · «{{ item.quote }}»
          </button>
          <button v-if="row.checkedRange" type="button" @click="emit('evidence', row.checkedRange)">
            Проверенный участок: {{ row.checkedRange.start + 1 }}–{{ row.checkedRange.end + 1 }}
          </button>
          <AppealRequest :key="result.evaluation.id + row.criterionId" :evaluation-id="result.evaluation.id" :criterion-id="row.criterionId" />
        </li>
      </ol>
    </article>
  </section>
</template>
