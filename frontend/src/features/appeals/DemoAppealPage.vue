<script setup>
import { computed, ref, watchPostEffect } from 'vue'
import { mountAppeals } from '../../../js/appeals.js'
import markup from './AppealForms.html?raw'
import { demoCases } from './demoCases.js'

const props = defineProps({ id: { type: String, required: true } })
const item = computed(() => demoCases.find(row => row.id === props.id))
const container = ref(null)
const appeal = ref(null)
watchPostEffect(() => {
  const row = item.value
  if (!row || !container.value) return
  const template = document.createElement('template')
  template.innerHTML = markup
  mountAppeals(container.value, {
    ...row, template, onRender: state => { appeal.value = state },
  })
})
</script>

<template>
  <RouterLink :to="{ name: 'appeals' }">К списку апелляций</RouterLink>
  <article v-if="item" class="appeal-detail">
    <h1>{{ item.title }}</h1>
    <p>Демопример · {{ item.criterion }}</p>
    <h2>Фрагмент диалога</h2>
    <ol><li v-for="([speaker, text], i) in item.turns" :key="i"><strong>{{ speaker }}</strong> — {{ text }}</li></ol>
    <p><strong>Обоснование анализатора.</strong> {{ item.explanation }}</p>
    <p>Исходный итог: {{ item.totalsByScore[item.original] }} / 100</p>
    <p v-if="appeal?.decision">Итог после решения: {{ item.totalsByScore[appeal.decision.score] }} / 100</p>
    <div ref="container"></div>
  </article>
  <p v-else>Демопример не найден.</p>
</template>
