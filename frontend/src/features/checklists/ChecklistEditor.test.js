import { beforeEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChecklistEditor from './ChecklistEditor.vue'
import { changeType, checklistError, toDraft } from './checklist.js'
import { readDemoVersion, saveDemoVersion } from './demo.js'

beforeEach(() => sessionStorage.clear())

it('создаёт независимый черновик и отправляет только поля для PUT', async () => {
  const source = readDemoVersion()
  Object.assign(source.criteria[0], { id: 'server-id', maxPoints: 1, position: 0,
    allowNa: true, naCondition: 'Неполная запись',
    applicabilityRule: { kind: 'recording_start_missing', channels: ['voice'] } })
  const view = mount(ChecklistEditor, { props: { source } })
  await view.get('textarea').setValue('Проверить только представление оператора.')
  await view.get('form').trigger('submit')
  const body = view.emitted('save')[0][0]
  expect(Object.keys(body).sort()).toEqual(['criteria', 'instructions', 'name', 'sections'])
  expect(body.criteria[0]).not.toHaveProperty('id')
  expect(body.criteria[0]).not.toHaveProperty('maxPoints')
  expect(body.criteria[0].applicabilityRule).toEqual(source.criteria[0].applicabilityRule)
  expect(source.criteria[0].description).not.toBe(body.criteria[0].description)
  expect(saveDemoVersion(source, body).version).toBe(2)
  expect(readDemoVersion().criteria[0].description).toBe(body.criteria[0].description)
})

it('проверяет веса, допустимость N/A и шкалу в обоих порядках', () => {
  const draft = toDraft(readDemoVersion())
  const c = draft.criteria[0]
  c.weight = 90
  expect(checklistError(draft)).toMatch(/100/)
  c.weight = 100
  c.allowNa = true
  expect(checklistError(draft)).toMatch(/N\/A/)
  c.naCondition = 'Чат завершён до запроса'
  changeType(c, 'scale')
  c.scaleSteps.reverse()
  expect(checklistError(draft)).toBe('')
  c.scaleSteps[0].value = 0
  expect(checklistError(draft)).toMatch(/ступени/)
  changeType(c, 'flag')
  expect(c).toMatchObject({ weight: 0, allowNa: false, naCondition: null, scaleSteps: [] })
})
