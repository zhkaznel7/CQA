import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises, RouterLinkStub } from '@vue/test-utils'
import DatasetPage from './DatasetPage.vue'

const respond = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
})
let page
afterEach(() => {
  page?.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('сохраняет группу импорта, обрабатывает каждый диалог и экспортирует выбранный набор', async () => {
  const evaluated = []
  let downloaded
  const request = vi.fn(async (path, options) => {
    const url = new URL(path, 'http://localhost')
    switch (url.pathname) {
      case '/api/checklists': return respond({ data: [
        { id: 'custom', key: 'custom', name: 'Другой чек-лист', version: 3 },
        { id: 'v2', key: 'freedom-broker-chat-quality', name: 'Правила', version: 2 },
        { id: 'v1', key: 'freedom-broker-chat-quality', name: 'Правила', version: 1 },
      ], pagination: { totalPages: 1 } })
      case '/api/conversations/import':
        expect(JSON.parse(options.body)).toEqual({ group_id: 'CONTROL' })
        return respond({ data: { groupId: 'CONTROL', received: 2, imported: 2, duplicates: 0, invalid: 0 } })
      case '/api/conversations':
        expect(url.searchParams.get('group_id')).toBe('CONTROL')
        return respond({ data: [{ id: 'a', externalId: 'x' }, { id: 'b', externalId: 'y' }], pagination: { totalPages: 1 } })
      case '/api/evaluations':
        evaluated.push(JSON.parse(options.body))
        return evaluated.length === 1 ? respond({ data: {} }) : respond({ error: { message: 'Ошибка модели' } }, 502)
      case '/api/exports/prod':
        expect(Object.fromEntries(url.searchParams)).toEqual({ group_id: 'CONTROL', team: 'Team', checklistId: 'v1' })
        return respond({ results: [{ status: 'ok' }, { status: 'error' }] })
      default: throw new Error(path)
    }
  })
  vi.stubGlobal('fetch', request)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:result')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloaded = this.download })
  page = mount(DatasetPage, { global: { stubs: { RouterLink: RouterLinkStub } } })
  await flushPromises()
  const [load, run, download] = page.findAll('form')
  await load.get('input').setValue('CONTROL')
  await load.trigger('submit')
  await flushPromises()
  expect(run.get('input').element.value).toBe('CONTROL')
  await run.trigger('submit')
  await flushPromises()
  expect(evaluated).toEqual([{ conversationId: 'a', checklistId: 'v1' }, { conversationId: 'b', checklistId: 'v1' }])
  expect(page.get('.batch-errors').text()).toContain('y · Ошибка модели')
  await download.get('input').setValue('Team')
  await download.trigger('submit')
  await flushPromises()
  expect(downloaded).toBe('results.json')
  expect(page.get('.dataset-report').text()).toContain('results/prod/results.json')
})
