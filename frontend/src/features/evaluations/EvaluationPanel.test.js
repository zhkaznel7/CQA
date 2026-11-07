import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ConversationCard from '../conversations/ConversationCard.vue'
import { conversation, demoService } from '../../../tests/fixtures/evaluation.js'

let view
afterEach(() => {
  view?.unmount()
  vi.unstubAllGlobals()
})

it('показывает N/A и переводит фокус к источнику оценки, включая диапазон', async () => {
  view = mount(ConversationCard, { attachTo: document.body, props: { conversation, service: demoService } })
  await flushPromises()
  await view.get('button').trigger('click')
  await flushPromises()
  expect(view.text()).toContain('Исходный ответ модели: N/A')
  expect(view.get('tbody tr').text()).toContain('50 / 100')
  await view.findAll('button').find(b => b.text().includes('Реплика 3')).trigger('click')
  expect(document.activeElement.id).toBe('turn-3')
  expect(view.findAll('mark')).toHaveLength(1)
  await view.findAll('button').find(b => b.text().includes('Проверенный участок')).trigger('click')
  expect(view.findAll('mark').map(m => m.element.parentElement.parentElement.id)).toEqual(['turn-3', 'turn-4'])
})

it('передаёт выбранные UUID и восстанавливается после ошибки сервера', async () => {
  const fixture = await demoService.evaluate()
  function response(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  const request = vi.fn(async (url, opts) => {
    if (url.startsWith('/api/appeals?')) return response({ data: [], pagination: { totalPages: 0 } })
    if (url.includes('?page=')) return response({ data: [fixture.checklist], pagination: { totalPages: 1 } })
    if (url.endsWith('/checklists/demo-rules')) return response({ data: fixture.checklist })
    expect(url).toBe('/api/evaluations')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ conversationId: conversation.id, checklistId: fixture.checklist.id })
    return request.mock.calls.length === 3
      ? response({ error: { message: 'AI недоступен' } }, 503)
      : response({ data: fixture.evaluation, reused: true })
  })
  vi.stubGlobal('fetch', request)
  view = mount(ConversationCard, { props: { conversation } })
  await flushPromises()
  await view.get('button').trigger('click')
  await flushPromises()
  expect(view.get('[role="alert"]').text()).toBe('AI недоступен')
  await view.get('button').trigger('click')
  await flushPromises()
  expect(view.text()).toContain('ранее сохранённая оценка')
  expect(view.find('[role="alert"]').exists()).toBe(false)
})

it('при повторной оценке показывает исходные 15 и действующие 20 по c4 и итогу', async () => {
  const fixture = await demoService.evaluate()
  const criterion = { key: 'c4', type: 'scale', weight: 20, value: 15, points: 15 }
  const original = { total: 15, grossError: false, sections: [], criteria: [criterion] }
  const finalScore = { ...original, total: 20, criteria: [{ ...criterion, value: 20, points: 20 }] }
  const evaluation = { id: 'eval', score: original, results: [
    { criterionId: 'criterion-uuid', criterionKey: 'c4', answer: 15, evidence: [] },
  ] }
  let accepted = false
  let detailAvailable = true
  function respond(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }
  const request = vi.fn(async url => {
    switch (url) {
      case '/api/checklists?page=1&pageSize=100':
        return respond({ data: [fixture.checklist], pagination: { totalPages: 1 } })
      case '/api/checklists/demo-rules': return respond({ data: fixture.checklist })
      case '/api/evaluations': return respond({ data: evaluation, reused: true })
      case '/api/appeals?status=ACCEPTED&page=1&pageSize=100':
        return respond({ data: [{ evaluationId: 'other', id: 'other-appeal' }], pagination: { totalPages: accepted ? 2 : 1 } })
      case '/api/appeals?status=ACCEPTED&page=2&pageSize=100':
        return respond({ data: [{ evaluationId: 'eval', id: 'appeal' }], pagination: { totalPages: 2 } })
      case '/api/appeals/appeal':
        return detailAvailable ? respond({ data: { finalScore, afterScore: original } }) : respond({}, 503)
      default: throw new Error(url)
    }
  })
  vi.stubGlobal('fetch', request)
  view = mount(ConversationCard, { props: { conversation } })
  await flushPromises()
  const evaluate = async () => {
    await view.findAll('button').find(b => b.text() === 'Оценить').trigger('click')
    await flushPromises()
  }
  const totals = () => view.get('tbody tr').findAll('td').map(cell => cell.text())
  await evaluate()
  expect(totals()).toEqual(['15 / 100', '15 / 100'])
  accepted = true
  await evaluate()
  expect(totals()).toEqual(['15 / 100', '20 / 100'])
  expect(view.text()).toContain('Исходный ответ модели: 15 · баллы 15')
  expect(view.text()).toContain('Действующий ответ: 20 · баллы 20')
  detailAvailable = false
  await evaluate()
  expect(totals()).toEqual(['15 / 100', 'Нет данных'])
  expect(view.get('[role="alert"]').text()).toContain('Не удалось получить действующую оценку')
})
