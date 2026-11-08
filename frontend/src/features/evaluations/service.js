import { getJson, postJson } from '../../shared/api.js'

// Each accepted appeal card contains the current score for the entire evaluation.
async function currentScore(evaluation, signal) {
  for (let page = 1; ; page++) {
    const list = await getJson(`/appeals?status=ACCEPTED&page=${page}&pageSize=100`, signal)
    const appeal = list.data.find(item => item.evaluationId === evaluation.id)
    if (appeal) {
      const { data } = await getJson('/appeals/' + encodeURIComponent(appeal.id), signal)
      if (!data.finalScore) throw new Error('Сервер не вернул пересчитанную оценку.')
      return data.finalScore
    }
    if (page >= list.pagination.totalPages) return evaluation.score
  }
}

export const evaluationService = {
  async listVersions(signal) {
    const versions = []
    let page = 1
    while (true) {
      const response = await getJson(`/checklists?page=${page}&pageSize=100`, signal)
      versions.push(...response.data)
      if (page >= response.pagination.totalPages) return versions
      page++
    }
  },

  async evaluate(conversationId, checklistId, signal) {
    const checklist = await getJson(`/checklists/${encodeURIComponent(checklistId)}`, signal)
    const evaluation = await postJson('/evaluations', { conversationId, checklistId }, signal)
    const result = { checklist: checklist.data, evaluation: evaluation.data, reused: evaluation.reused }
    try {
      return { ...result, currentScore: await currentScore(evaluation.data, signal) }
    } catch (error) {
      if (signal?.aborted) throw error
      return { ...result, currentScore: null, reviewError: error.message }
    }
  },
}
