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
  <form class="checklist-editor" @submit.prevent="submit">
    <fieldset class="editor-body" :disabled="saving">
      <legend>{{ source.id ? 'На основе версии ' + source.version : 'Новый чек-лист' }}</legend>
      <div class="editor-meta">
        <label v-if="!source.id">Код чек-листа <input v-model="draft.key" required maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9_\-]*"></label>
        <label>Название чек-листа <input v-model="draft.name" maxlength="200" required></label>
      </div>
      <h2>Критерии <small>{{ draft.criteria.length }}</small></h2>
      <details v-for="(c, i) in draft.criteria" :key="c" class="criterion" :open="i === 0 || !source.id || i >= source.criteria.length"
        @invalid.capture="$event.currentTarget.open = true">
        <summary>
          <span class="criterion-key">{{ c.key || i + 1 }}</span>
          <strong>{{ c.name || 'Новый критерий' }}</strong><span class="weight">{{ c.type === 'flag' ? 'Флаг' : 'Вес ' + c.weight }}</span>
        </summary>
        <div class="criterion-content">
          <CriterionFields :criterion="c" :sections="draft.sections" />
          <button type="button" class="remove-criterion" :disabled="draft.criteria.length === 1" @click="draft.criteria.splice(i, 1)">Удалить критерий</button>
        </div>
      </details>
      <button class="add-criterion" type="button" :disabled="draft.criteria.length >= 100" @click="draft.criteria.push(newCriterion(draft.sections[0].key))">Добавить критерий</button>
      <div class="save-version">
        <div class="weight-total">
          <label for="checklist-weights">Сумма весов <strong>{{ total }} / 100</strong></label>
          <progress id="checklist-weights" max="100" :value="total"></progress>
        </div>
        <button type="submit">{{ saving ? 'Сохранение…' : 'Сохранить новую версию' }}</button>
      </div>
      <p v-if="error" role="alert">{{ error }}</p>
    </fieldset>
  </form>
</template>

<style scoped>
.checklist-editor { max-width:1020px }
.editor-body { padding:20px; margin:12px 0; border:1px solid #dce3ec; border-radius:10px; background:#fff; min-width:0 }
.editor-body > legend { background:#e8f1ff; border:1px solid #cadcf6; border-radius:5px; padding:3px 9px; color:#285c9e; font-size:12px; font-weight:650 }
.editor-meta { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr)); gap:14px }
.editor-body label { display:grid; gap:6px; font-size:13px; color:#465a75; font-weight:600 }
.editor-body h2 { margin:22px 0 12px; display:flex; gap:8px; align-items:center; font-size:18px }
.editor-body h2 small { background:#edf2f8; padding:2px 7px; border-radius:5px; font-size:12px }
.criterion { margin:0 0 8px; background:white; border:1px solid #dce3ec; border-radius:8px; overflow:hidden; transition:border-color .18s }
.criterion[open] { border-color:#b5ccec }
.criterion summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:12px; min-height:50px; padding:9px 14px; transition:background .16s }
.criterion summary::-webkit-details-marker { display:none }
.criterion[open] summary,.criterion summary:hover { background:#f4f8fe }
.criterion summary::after { content:''; width:7px; height:7px; border-right:1.5px solid #536982; border-bottom:1.5px solid #536982; transform:rotate(45deg); margin:0 4px 4px; transition:transform .22s }
.criterion[open] summary::after { transform:rotate(225deg); margin:4px 4px 0 }
.criterion summary strong { flex:1; overflow-wrap:anywhere; color:#243853; font-size:14px }
.criterion-key { display:grid; place-items:center; min-width:30px; min-height:28px; max-width:30%; overflow-wrap:anywhere; border-radius:5px; background:#e8f1ff; color:#175aa4; font-size:12px; font-variant-numeric:tabular-nums; font-weight:700; padding:2px 4px }
.weight { flex:none; font-size:12px; color:#657891 }
.criterion-content { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); align-items:start; gap:14px; padding:16px 14px; border-top:1px solid #e5ecf4 }
.criterion-content :deep(label) { display:grid; gap:5px; color:#425772; font-size:13px; font-weight:600 }
.criterion-content :deep(textarea),.criterion-content :deep(input:not([type=checkbox])),.criterion-content :deep(select),.editor-meta input { box-sizing:border-box; width:100%; min-width:0 }
.criterion-content :deep(.wide-field),.criterion-content :deep(.scale-steps),.criterion-content :deep(p) { grid-column:1/-1 }
.criterion-content :deep(.check-field) { display:flex; align-items:center; gap:8px; align-self:center }
.criterion-content :deep(.scale-steps) { min-width:0; margin:0; border:1px solid #dfe6ef; padding:12px; border-radius:6px }
.criterion-content :deep(.scale-steps legend) { padding:0 5px; font-size:13px; font-weight:600 }
.criterion-content :deep(.scale-step) { display:grid; grid-template-columns:minmax(65px,.45fr) minmax(110px,2fr) auto; align-items:end; gap:8px; margin:0 0 8px }
.criterion-content :deep(.scale-step button),.remove-criterion { color:#8a4242 }
.remove-criterion { grid-column:1/-1; justify-self:start }
.add-criterion { margin-top:6px }
.save-version { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px; padding-top:18px; margin-top:18px; border-top:1px solid #e4eaf2 }
.weight-total { flex:1; max-width:240px; min-width:140px }
.weight-total label { display:flex; justify-content:space-between; gap:10px; font-size:12px; color:#687991 }
.weight-total strong { color:#193456 }
.weight-total progress { width:100%; height:5px; accent-color:#1473b3; border:0 }
.save-version button { background:#1768d5; color:white; border:1px solid #1768d5; border-radius:5px }
@media(max-width:650px){ .editor-body { padding:13px } .criterion-content { grid-template-columns:repeat(2,minmax(0,1fr)) } .criterion-content :deep(.scale-step){grid-template-columns:1fr} }
@media(max-width:440px){ .criterion-content{grid-template-columns:1fr} }
</style>
