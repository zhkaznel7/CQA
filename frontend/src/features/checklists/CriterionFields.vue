<script setup>
import { changeType } from './checklist.js'

const props = defineProps({ criterion: { type: Object, required: true }, sections: Array })
function changeNa(enabled) {
  props.criterion.allowNa = enabled
  if (!enabled) {
    props.criterion.naCondition = null
    delete props.criterion.applicabilityRule
  }
}
</script>

<template>
  <label>Код <input v-model="criterion.key" pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" required maxlength="100"></label>
  <label>Название критерия <input v-model="criterion.name" required maxlength="200"></label>
  <label>Формулировка <textarea v-model="criterion.description" required maxlength="10000"></textarea></label>
  <label>Секция
    <select v-model="criterion.sectionKey"><option v-for="s in sections" :key="s.key" :value="s.key">{{ s.name }}</option></select>
  </label>
  <label>Тип ответа
    <select :value="criterion.type" @change="changeType(criterion, $event.target.value)">
      <option value="boolean">Да / Нет</option><option value="scale">Числовая шкала</option><option value="flag">Флаг нарушения</option>
    </select>
  </label>
  <label v-if="criterion.type !== 'flag'">Вес <input v-model.number="criterion.weight" type="number" min="0.01" max="100" step="0.01" required></label>
  <fieldset v-if="criterion.type === 'scale'">
    <legend>Ступени шкалы</legend>
    <div v-for="(step, index) in criterion.scaleSteps" :key="index">
      <label>Балл <input v-model.number="step.value" type="number" min="0" max="1000000" step="0.0001" required></label>
      <label>Описание ступени <input v-model="step.label" maxlength="1000" required></label>
      <button type="button" @click="criterion.scaleSteps.splice(index, 1)">Удалить ступень</button>
    </div>
    <button type="button" :disabled="criterion.scaleSteps.length >= 50" @click="criterion.scaleSteps.push({ value: '', label: '' })">Добавить ступень</button>
  </fieldset>
  <template v-if="criterion.type !== 'flag'">
    <label><input type="checkbox" :checked="criterion.allowNa" @change="changeNa($event.target.checked)"> Допускать N/A</label>
    <label v-if="criterion.allowNa">Условие N/A <textarea v-model="criterion.naCondition" required maxlength="2000"></textarea></label>
    <p v-if="criterion.applicabilityRule">Для N/A действует серверная проверка неполного начала записи звонка.</p>
  </template>
</template>
