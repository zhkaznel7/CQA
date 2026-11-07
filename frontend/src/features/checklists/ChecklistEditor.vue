<script setup>
import { computed, ref } from 'vue'
import CriterionFields from './CriterionFields.vue'
import { checklistError, newCriterion, toDraft } from './checklist.js'

const props = defineProps({ source: { type: Object, required: true }, saving: Boolean })
const emit = defineEmits(['save'])
const draft = ref(toDraft(props.source))
const error = ref('')
const total = computed(() => draft.value.criteria.reduce((sum, c) => sum + Math.round(c.weight * 100), 0) / 100)

function submit() {
  error.value = checklistError(draft.value)
  if (error.value) return
  const body = toDraft(draft.value)
  if (props.source.id) delete body.key
  emit('save', body)
}
</script>

<template>
  <form @submit.prevent="submit">
    <fieldset :disabled="saving">
      <legend>{{ source.id ? 'На основе версии ' + source.version : 'Новый чек-лист' }}</legend>
      <label v-if="!source.id">Код чек-листа <input v-model="draft.key" required maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9_\-]*"></label>
      <label>Название чек-листа <input v-model="draft.name" maxlength="200" required></label>
      <fieldset v-for="(c, i) in draft.criteria" :key="i" class="criterion">
        <legend>Критерий {{ i + 1 }}</legend>
        <CriterionFields :criterion="c" :sections="draft.sections" />
        <button type="button" :disabled="draft.criteria.length === 1" @click="draft.criteria.splice(i, 1)">Удалить критерий</button>
      </fieldset>
      <button type="button" :disabled="draft.criteria.length >= 100" @click="draft.criteria.push(newCriterion(draft.sections[0].key))">Добавить критерий</button>
      <p>Сумма весов: {{ total }} / 100</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit">{{ saving ? 'Сохранение…' : 'Сохранить новую версию' }}</button>
    </fieldset>
  </form>
</template>
