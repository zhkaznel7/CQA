<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { evaluationService } from './service.js'

const props = defineProps({
  conversationId: { type: String, required: true },
  service: { type: Object, default: () => evaluationService },
})
const emit = defineEmits(['evidence'])
const versions = shallowRef([])
const selected = ref('')
const result = shallowRef(null)
const busy = ref(false)
const error = ref('')
const controller = new AbortController()

async function run(action) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause.message
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
    result.value = await props.service.evaluate(props.conversationId, selected.value, controller.signal)
  })
}

const rows = computed(() => {
  if (!result.value) return []
  const { evaluation, checklist } = result.value
  const names = new Map(checklist.criteria.map(c => [c.key, c.name]))
  const scores = new Map(evaluation.score.criteria.map(c => [c.key, c]))
  return evaluation.results.map(row => ({
    ...row, name: names.get(row.criterionKey) ?? row.criterionKey, score: scores.get(row.criterionKey),
  }))
})

function answer(row) {
  if (row.isNa) return 'N/A'
  if (typeof row.answer === 'boolean') return row.answer ? 'Да' : 'Нет'
  return row.answer
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
        <select v-model="selected" :disabled="busy" @change="result = null">
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
      <p v-if="result.evaluation.isMock">Демонстрационная оценка</p>
      <p v-if="result.reused">Получена ранее сохранённая оценка.</p>
      <p>Итог: {{ result.evaluation.score.total === null ? 'не рассчитан' : points.format(result.evaluation.score.total) + ' / 100' }}</p>
      <p>Грубая ошибка: {{ result.evaluation.score.grossError ? 'да' : 'нет' }}</p>
      <ul v-if="result.evaluation.score.sections.length">
        <li v-for="s in result.evaluation.score.sections" :key="s.key">
          {{ s.name }}: {{ points.format(s.points) }} / {{ points.format(s.maxPoints) }}
        </li>
      </ul>
      <ol>
        <li v-for="row in rows" :key="row.criterionId">
          <strong>{{ row.name }} — {{ answer(row) }}</strong>
          <span v-if="row.score && row.score.type !== 'flag'"> · вес {{ row.score.weight }}<template v-if="!row.isNa"> · баллы {{ points.format(row.score.points) }}</template></span>
          <p>{{ row.explanation }}</p>
          <p v-if="row.isNa && row.naReason">Причина N/A: {{ row.naReason }}</p>
          <button v-for="(item, i) in row.evidence" :key="i" type="button"
            @click="emit('evidence', { start: item.turnIndex, end: item.turnIndex })">
            Реплика {{ item.turnIndex + 1 }} · «{{ item.quote }}»
          </button>
          <button v-if="row.checkedRange" type="button" @click="emit('evidence', row.checkedRange)">
            Проверенный участок: {{ row.checkedRange.start + 1 }}–{{ row.checkedRange.end + 1 }}
          </button>
        </li>
      </ol>
    </article>
  </section>
</template>
