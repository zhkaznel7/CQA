import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../../app/App.vue'
import { routes } from '../../app/routes.js'

beforeEach(() => localStorage.clear())

it('работает офлайн: подача, смена балла, очередь и сохранение истории', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  const router = createRouter({ history: createMemoryHistory(), routes })
  let view
  try {
    await router.push('/appeals')
    await router.isReady()
    view = mount(App, { global: { plugins: [router] } })
    expect(view.text()).toContain('Тарифы и дата обновления')
    await router.push('/demo/appeals/period')
    await flushPromises()
    await view.get('[name=comment]').setValue('Пожалуйста, проверьте фрагмент.')
    await view.get('[data-request]').trigger('submit')
    expect(view.get('[data-status]').text()).toBe('Ожидает решения')
    await view.get('[name=action]').setValue('change')
    await view.get('[name=score]').setValue('15')
    await view.get('[name=reason]').setValue('Указан корректный первый шаг.')
    await view.get('[data-review]').trigger('submit')
    expect(view.text()).toContain('Итог после решения: 75 / 100')
    expect(view.text()).toContain('Исходный итог: 70 / 100')
    await router.push('/appeals')
    await flushPromises()
    expect(view.findAll('li').find(li => li.text().includes('Выписка')).text()).toContain('Рассмотрено')
    await router.push('/demo/appeals/period')
    await flushPromises()
    expect(view.get('[data-reason]').text()).toContain('Указан корректный первый шаг.')
    expect(view.get('[data-review]').element.hidden).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally {
    view?.unmount()
    fetchSpy.mockRestore()
  }
})
