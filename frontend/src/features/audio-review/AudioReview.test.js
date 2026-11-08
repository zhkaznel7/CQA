import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AudioReview from './AudioReview.vue'
const demoRecording = {
  audioUrl: '/test.wav',
  turns: [
    { speaker: 'Оператор', text: 'Привет. Чем помочь?', start: 0, end: 3,
      words: [{ text: 'Привет.', start: 0, end: 1 }, { text: 'Чем', start: 1, end: 2 }, { text: 'помочь?', start: 2, end: 3 }] },
    { speaker: 'Клиент', text: 'Отчёт', start: 4, end: 5 },
  ],
  findings: [{ id: 'greeting', criterion: 'Установление контакта', explanation: 'Приветствие', start: 0, end: 1 }],
}

function review(recording = demoRecording) {
  return mount(AudioReview, {
    props: { recording },
    global: { stubs: { WaveformPlayer: true } },
  })
}

describe('выделение аудио', () => {
  it('выводит отдельные слова и исключает замечание на соседней границе', async () => {
    const view = review()
    expect(view.get('.audio-findings').text()).toContain('Установление контакта')
    const word = demoRecording.turns[0].words[1]
    view.getComponent({ name: 'WaveformPlayer' }).vm.$emit('select', {
      start: word.start, end: word.end,
    })
    await view.vm.$nextTick()
    expect(view.get('.audio-excerpt').text()).toContain(word.text)
    expect(view.get('.audio-excerpt').text()).not.toContain('Привет')
    expect(view.find('.audio-findings').exists()).toBe(false)
  })

  it('показывает пустое выделение в паузе между репликами', async () => {
    const view = review()
    view.getComponent({ name: 'WaveformPlayer' }).vm.$emit('select', {
      start: demoRecording.turns[0].end, end: demoRecording.turns[1].start,
    })
    await view.vm.$nextTick()
    expect(view.text()).toContain('нет размеченных слов')
    expect(view.find('.audio-findings').exists()).toBe(false)
  })

  it('помечает целую реплику, когда сервер передал только границы реплик', () => {
    const turn = { ...demoRecording.turns[0], words: undefined }
    const view = review({ ...demoRecording, turns: [turn] })
    expect(view.text()).toContain(turn.text)
    expect(view.text()).toContain('нет меток слов')
  })
})
