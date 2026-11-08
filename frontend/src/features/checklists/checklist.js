export function newCriterion(sectionKey) {
  return {
    key: '', name: '', description: '', sectionKey, type: 'boolean',
    weight: 0, allowNa: false, naCondition: null, scaleSteps: [],
  }
}

export function newChecklist() {
  return {
    key: '', name: '', sections: [{ key: 'main', name: 'Основная секция' }],
    instructions: [], criteria: [{ ...newCriterion('main'), weight: 100 }],
  }
}

// Собираем разрешённые поля записи: конфигурация GET содержит также id и вычисленные поля.
export function toDraft(source) {
  return {
    key: source.key, name: source.name,
    sections: source.sections.map(({ key, name }) => ({ key, name })),
    instructions: [...source.instructions],
    criteria: source.criteria.map(c => ({
      key: c.key, name: c.name, description: c.description, type: c.type, weight: c.weight,
      sectionKey: c.sectionKey, allowNa: c.allowNa, naCondition: c.naCondition ?? null,
      scaleSteps: (c.scaleSteps ?? []).map(({ value, label }) => ({ value, label })),
      ...(c.applicabilityRule ? { applicabilityRule: { kind: c.applicabilityRule.kind, channels: [...c.applicabilityRule.channels] } } : {}),
    })),
  }
}

export function changeType(c, type) {
  c.type = type
  c.scaleSteps = type === 'scale' ? [{ value: 0, label: 'Нет' }, { value: 1, label: 'Да' }] : []
  if (type !== 'boolean') delete c.applicabilityRule
  if (type === 'flag') {
    c.weight = 0
    c.allowNa = false
    c.naCondition = null
  }
}

export function checklistError(draft) {
  const seen = new Set()
  for (const [i, c] of draft.criteria.entries()) {
    const label = 'Критерий ' + (i + 1)
    if (seen.has(c.key)) return label + ': код критерия уже используется.'
    seen.add(c.key)
    if (!c.name.trim() || !c.description.trim()) return label + ': заполните название и формулировку.'
    if (c.type !== 'flag' && !(c.weight > 0)) return label + ': вес должен быть положительным.'
    if (c.allowNa && !c.naCondition?.trim()) return label + ': укажите условие N/A.'
    if (c.type === 'scale') {
      const values = c.scaleSteps.map(s => s.value)
      const ascending = values.every((v, n) => n === 0 || v > values[n - 1])
      const descending = values.every((v, n) => n === 0 || v < values[n - 1])
      if (values.length < 2 || !values.includes(0) || !(ascending || descending)) {
        return label + ': нужны минимум две ступени, включая 0, строго по возрастанию или убыванию.'
      }
      if (c.scaleSteps.some(s => !s.label.trim())) return label + ': подпишите каждую ступень.'
    }
  }
  if (!draft.name.trim()) return 'Введите название чек-листа.'
  if (draft.criteria.reduce((n, c) => n + Math.round(c.weight * 100), 0) !== 10000) {
    return 'Сумма весов оцениваемых критериев должна составлять 100.'
  }
  return ''
}
