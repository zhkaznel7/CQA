import { deleteRecord, getJson, postJson } from '../../shared/api.js'

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

  async history(conversationId, signal) {
    return (await getJson('/evaluations?' + new URLSearchParams({ conversationId }), signal)).data
  },

  remove(evaluationId, signal) {
    return deleteRecord('/evaluations/' + encodeURIComponent(evaluationId), signal)
  },

  async open(evaluationId, checklistId, signal) {
    const [checklist, evaluation] = await Promise.all([
      getJson('/checklists/' + encodeURIComponent(checklistId), signal),
      getJson('/evaluations/' + encodeURIComponent(evaluationId), signal),
    ])
    return withReview(checklist.data, evaluation.data, true, signal)
  },

  async evaluate(conversationId, checklistId, signal) {
    const checklist = await getJson('/checklists/' + encodeURIComponent(checklistId), signal)
    const evaluation = await postJson('/evaluations', { conversationId, checklistId }, signal)
    return withReview(checklist.data, evaluation.data, evaluation.reused, signal)
  },
}

async function withReview(checklist, evaluation, reused, signal) {
  const result = { checklist, evaluation, reused }
  try {
    return { ...result, currentScore: await currentScore(evaluation, signal) }
  } catch (error) {
    if (signal?.aborted) throw error
    return { ...result, currentScore: null, reviewError: error.message }
  }
}
