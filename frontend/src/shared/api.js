const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export function apiUrl(path) {
  return baseUrl + path
}

async function requestJson(path, { signal, body, method }) {
  const options = { method, signal, headers: { Accept: 'application/json' } }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(apiUrl(path), options)
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const error = new Error(payload?.error?.message || `Ошибка API (HTTP ${response.status})`)
    error.details = payload?.error?.details
    error.code = payload?.error?.code
    throw error
  }
  if (method === 'DELETE' && response.status === 204) return
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Сервер вернул неожиданный формат. Проверьте адрес API.')
  }
  return response.json()
}

export function getJson(path, signal) {
  return requestJson(path, { signal })
}

export function postJson(path, body, signal) {
  return requestJson(path, { signal, body, method: 'POST' })
}

export function putJson(path, body, signal) {
  return requestJson(path, { signal, body, method: 'PUT' })
}

export function patchJson(path, body, signal) {
  return requestJson(path, { signal, body, method: 'PATCH' })
}

export function deleteRecord(path, signal) {
  return requestJson(path, { method: 'DELETE', signal })
}
