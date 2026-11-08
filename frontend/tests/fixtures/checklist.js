export const initial = {
  id: 'demo-checklist-1', key: 'demo', version: 1, name: 'Демочат',
  sections: [{ key: 'main', name: 'Основная секция' }], instructions: [],
  criteria: [{
    key: 'contact', name: 'Приветствие', description: 'Оператор поздоровался и представился.',
    sectionKey: 'main', type: 'boolean', weight: 100, allowNa: false, naCondition: null, scaleSteps: [],
  }],
}
