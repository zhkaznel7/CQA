const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

async function requestJson(path, { signal, body }) {
  const options = { signal, headers: { Accept: 'application/json' } }
  if (body !== undefined) {
    options.method = 'POST'
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(baseUrl + path, options)
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error?.message || `Ошибка API (HTTP ${response.status})`)
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Сервер вернул неожиданный формат. Проверьте адрес API.')
  }
  return response.json()
}

export function getJson(path, signal) {
  return requestJson(path, { signal })
}

export function postJson(path, body, signal) {
  return requestJson(path, { signal, body })
}
