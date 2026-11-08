import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from './App.vue'
import { routes } from './routes.js'

let wrapper
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

async function openApp(path) {
  const request = globalThis.fetch
  vi.stubGlobal('fetch', (url, opts) => url === '/api/health' ? Promise.resolve(json({ status: 'ok' })) : request(url, opts))
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  wrapper = mount(App, { global: { plugins: [router] } })
  return router
}

it('открывает диалог по внутреннему ID и сохраняет нумерацию всех реплик', async () => {
  const item = { id: 'internal-1', externalId: 'dev-01', language: 'RU', channel: 'chat' }
  const request = vi.fn()
    .mockResolvedValueOnce(json({ data: [item], pagination: { totalPages: 1 } }))
    .mockResolvedValueOnce(json({ data: { ...item, transcript: [
      { speaker: 'system', text: 'Начало' }, { speaker: 'operator', text: 'Здравствуйте' },
    ] } }))
    .mockResolvedValueOnce(json({ data: [], pagination: { totalPages: 0 } }))
  vi.stubGlobal('fetch', request)
  await openApp('/dialogs')
  await vi.waitFor(() => expect(wrapper.text()).toContain('dev-01'))
  await wrapper.get('a[href$="/dialogs/internal-1"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.find('#turn-2').exists()).toBe(true))
  expect(wrapper.get('#turn-2').text()).toContain('Здравствуйте')
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    '/api/conversations?page=1', '/api/conversations/internal-1', '/api/checklists?page=1&pageSize=100',
  ])
})

it('показывает ошибку API и повторяет загрузку списка', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(json({ error: { message: 'Сервис недоступен' } }, 503))
    .mockResolvedValueOnce(json({ data: [], pagination: { totalPages: 0 } })))
  await openApp('/appeals')
  await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
  await wrapper.findAll('button').find(b => b.text() === 'Повторить').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('Апелляций пока нет.'))
})
