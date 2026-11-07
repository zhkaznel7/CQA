const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export async function getJson(path, signal) {
  const response = await fetch(baseUrl + path, {
    signal, headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error?.message || `Ошибка API (HTTP ${response.status})`)
  }
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Сервер вернул неожиданный формат. Проверьте адрес API.')
  }
  return response.json()
}
