import { expect, it } from 'vitest'
import { recordingFor } from './recording.js'

it('привязывает вывод по исходному индексу и только при наличии интервала в записи', () => {
  const conversation = { audioUrl: '/call', transcript: [
    { speaker: 'system', timestamp: '2026-11-07T08:00:00Z' },
    { speaker: 'operator', text: 'Привет!', startMs: 2500, endMs: 3200,
      words: [{ text: 'Привет!', startMs: 2550, endMs: 3100 }] },
  ] }
  const result = { checklist: { criteria: [{ key: '01', name: 'Контакт' }] },
    evaluation: { results: [{ criterionKey: '01', criterionId: 'c', evidence: [{ turnIndex: 1 }], explanation: 'Приветствие' }] } }
  const audio = recordingFor(conversation, result)
  expect(audio.turns).toHaveLength(1)
  expect(audio.turns[0].words[0]).toEqual({ text: 'Привет!', start: 2.55, end: 3.1 })
  expect(audio.findings[0]).toMatchObject({ criterion: 'Контакт', start: 2.5, end: 3.2 })
})
