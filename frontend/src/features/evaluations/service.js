import { getJson, postJson } from '../../shared/api.js'

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
    return { checklist: checklist.data, evaluation: evaluation.data, reused: evaluation.reused }
  },
}
