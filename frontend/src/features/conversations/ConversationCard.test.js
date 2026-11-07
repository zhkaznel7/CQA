import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import ConversationCard from './ConversationCard.vue'

it.each([
  ['https://dev.environment.api.powerplatform.com/powerautomate/automations/direct/audio', true],
  ['https://example.org/audio.mp3', false],
  ['https://dev.environment.api.powerplatform.com.example.org/powerautomate/automations/direct/audio', false],
])('обрабатывает ошибку воспроизведения %s', async (audioUrl, usePlayer) => {
  const view = mount(ConversationCard, {
    props: { conversation: { id: 'test', transcript: [], audioUrl } },
    global: { stubs: { EvaluationPanel: true } },
  })
  try {
    expect(view.get('audio').attributes('src')).toBe(audioUrl)
    await view.get('audio').trigger('error')
    expect(view.find('iframe').exists()).toBe(usePlayer)
    if (usePlayer) {
      expect(view.get('iframe').attributes('sandbox')).toBe('')
      expect(view.get('a').attributes('href')).toBe(audioUrl)
    }
  } finally {
    view.unmount()
  }
})
