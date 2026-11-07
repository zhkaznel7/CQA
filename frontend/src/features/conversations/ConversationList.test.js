import { expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ConversationList from './ConversationList.vue'

it('объединяет псевдонимы звонков со всех страниц и перелистывает выбранную языковую группу', async () => {
  const rows = Array.from({ length: 103 }, (_, i) => ({
    id: String(i), externalId: 'dev-' + i, language: 'RU',
    channel: i < 22 ? ['voice', 'voice call', ' CALL '][i % 3] : i === 102 ? 'call' : 'chat',
  }))
  const request = vi.fn(async url => {
    const { searchParams } = new URL(url, 'http://localhost')
    expect(searchParams.get('language')).toBe('RU')
    expect(searchParams.get('pageSize')).toBe('100')
    const page = Number(searchParams.get('page'))
    return new Response(JSON.stringify({
      data: rows.slice((page - 1) * 100, page * 100), pagination: { totalPages: 2 },
    }), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', request)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { name: 'conversations', path: '/dialogs', component: ConversationList },
      { name: 'conversation', path: '/dialogs/:id', component: { template: '<div />' } },
    ],
  })
  let view
  try {
    await router.push('/dialogs?channel=voice%20call&language=RU')
    view = mount(ConversationList, { global: { plugins: [router] } })
    await flushPromises()
    expect(view.get('.dialog-table-footer strong').text()).toBe('23')
    expect(view.findAll('tbody tr')).toHaveLength(20)
    await view.get('[aria-label="Следующая страница"]').trigger('click')
    await flushPromises()
    expect(view.findAll('.dialog-link').map(link => link.text())).toEqual(['dev-20', 'dev-21', 'dev-102'])
    expect(request).toHaveBeenCalledTimes(2)
  } finally {
    view?.unmount()
    vi.unstubAllGlobals()
  }
})
