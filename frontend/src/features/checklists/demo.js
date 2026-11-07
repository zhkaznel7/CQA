const storageKey = 'cqa.demo.checklist'
const initial = {
  id: 'demo-checklist-1', key: 'demo', version: 1, name: 'Демочат',
  sections: [{ key: 'main', name: 'Основная секция' }], instructions: [],
  criteria: [{
    key: 'contact', name: 'Приветствие', description: 'Оператор поздоровался и представился.',
    sectionKey: 'main', type: 'boolean', weight: 100, allowNa: false, naCondition: null, scaleSteps: [],
  }],
}

export function readDemoVersion() {
  const stored = sessionStorage.getItem(storageKey)
  return stored ? JSON.parse(stored) : structuredClone(initial)
}

export function saveDemoVersion(previous, body) {
  const version = previous.version + 1
  const saved = { ...body, key: previous.key, version, id: 'demo-checklist-' + version }
  sessionStorage.setItem(storageKey, JSON.stringify(saved))
  return saved
}
