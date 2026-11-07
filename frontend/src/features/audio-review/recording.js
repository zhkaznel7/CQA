function seconds(ms) {
  if (ms == null || ms === '') return null
  const n = Number(ms)
  return Number.isFinite(n) && n >= 0 ? n / 1000 : null
}

function interval(item) {
  const start = seconds(item.startMs)
  const end = seconds(item.endMs)
  return start != null && end != null && end > start ? { start, end } : null
}

export function recordingFor(conversation, result) {
  const turns = conversation.transcript.flatMap((turn, index) => {
    const time = interval(turn)
    if (!time) return []
    const words = turn.words?.flatMap(word => {
      const span = interval(word)
      return span && word.text ? [{ ...span, text: word.text }] : []
    })
    return [{ ...time, index, speaker: turn.speaker, text: turn.text, words: words?.length ? words : undefined }]
  })
  const findings = (result?.evaluation.results ?? []).flatMap(row => {
    const hits = new Set(row.evidence.map(e => e.turnIndex))
    const name = result.checklist.criteria.find(c => c.key === row.criterionKey)?.name ?? row.criterionKey
    return turns.filter(t => hits.has(t.index) || (row.checkedRange &&
      t.index >= row.checkedRange.start && t.index <= row.checkedRange.end)).map(t => ({
      id: row.criterionId + '-' + t.index, start: t.start, end: t.end,
      criterion: name, explanation: row.explanation,
    }))
  })
  return { audioUrl: conversation.audioUrl, turns, findings }
}
