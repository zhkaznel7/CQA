import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import AppealReview from './AppealReview.vue'
import AppealRequest from './AppealRequest.vue'

afterEach(() => vi.unstubAllGlobals())

const initial = {
  id: 'appeal-1', status: 'PENDING', reviewable: true, criterionId: 'criterion-1',
  criterion: { key: 'greeting', name: 'Приветствие' }, conversation: { externalId: 'chat-1', transcript: [] },
  originalResult: { answer: true, evidence: [] }, originalScore: { total: 90 },
  finalScore: { total: 90 }, checklist: { criteria: [{ key: 'greeting', type: 'boolean', allowNa: true }] },
}
function respond(data) {
  return new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } })
}

it('отправляет серверу ID оценки, UUID критерия и комментарий', async () => {
  const fetch = vi.fn().mockResolvedValue(respond({ id: 'saved' }))
  vi.stubGlobal('fetch', fetch)
  const view = mount(AppealRequest, {
    props: { evaluationId: 'evaluation-1', criterionId: 'criterion-1' },
    global: { stubs: { RouterLink: true } },
  })
  await view.get('button').trigger('click')
  await view.get('textarea').setValue('Проверьте реплику')
  await view.get('form').trigger('submit')
  await flushPromises()
  const [url, opts] = fetch.mock.calls[0]
  expect([url, opts.method]).toEqual(['/api/appeals', 'POST'])
  expect(JSON.parse(opts.body)).toEqual({ evaluationId: 'evaluation-1', criterionId: 'criterion-1', comment: 'Проверьте реплику' })
  expect(view.find('router-link-stub').exists()).toBe(true)
})

it.each([[false, { value: false }], ['na', { isNa: true, naReason: 'Проверка не требовалась' }]])(
  'сохраняет тип ответа %s и выводит итог из ответа PATCH', async (value, fields) => {
    const fetch = vi.fn().mockResolvedValue(respond({
      ...initial, decision: 'CHANGE', reason: 'Пересмотр', status: 'ACCEPTED', finalScore: { total: 78 },
    }))
    vi.stubGlobal('fetch', fetch)
    const view = mount(AppealReview, { props: { initial } })
    await view.get('select').setValue('CHANGE')
    await view.findAll('select')[1].setValue(String(value))
    if (value === 'na') await view.findAll('textarea')[0].setValue(fields.naReason)
    await view.findAll('textarea').at(-1).setValue('Пересмотр')
    await view.get('form').trigger('submit')
    await flushPromises()
    const [url, opts] = fetch.mock.calls[0]
    expect([url, opts.method]).toEqual(['/api/appeals/appeal-1/decision', 'PATCH'])
    expect(JSON.parse(opts.body)).toEqual({ decision: 'CHANGE', reason: 'Пересмотр', ...fields })
    expect(view.text()).toContain('Текущий итог: 78')
    expect(view.find('form').exists()).toBe(false)
  })
