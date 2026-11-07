import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ConversationCard from '../conversations/ConversationCard.vue'
import { conversation, demoService } from './demo.js'

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
  expect(view.text()).toContain('Идентификация — N/A')
  expect(view.text()).toContain('Итог: 50 / 100')
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
