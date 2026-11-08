import { getJson } from '../../shared/api.js'

export function channelOf(value) {
  const name = String(value ?? '').trim().toLowerCase()
  if (['voice', 'voice call', 'call'].includes(name)) return 'voice'
  if (['agent chat', 'chat'].includes(name)) return 'chat'
  return 'other'
}

export async function fetchDialogs(signal, language = '', groupId = '') {
  const byId = new Map()
  let page = 1
  while (true) {
    const params = new URLSearchParams({ page: String(page), pageSize: '100' })
    if (language) params.set('language', language)
    if (groupId) params.set('group_id', groupId)
    const result = await getJson('/conversations?' + params, signal)
    for (const item of result.data) byId.set(item.id, item)
    if (page >= result.pagination.totalPages) return [...byId.values()]
    page++
  }
}
