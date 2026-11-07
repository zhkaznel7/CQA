import { channelOf } from './conversation-catalog.js'

const languages = { RU: 'Русский', KZ: 'Казахский', EN: 'Английский' }
const speakers = { operator: 'Оператор', client: 'Клиент', system: 'Система', bot: 'Бот' }
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export const channelName = channel => ({ chat: 'Чат', voice: 'Звонок' })[channelOf(channel)] ?? channel
export const channelIcon = channel => channelName(channel) === 'Звонок' ? 'phone' : 'chat'
export const languageName = code => languages[code] ?? code
export const speakerName = role => speakers[role] ?? role
export const groupName = group => group === '__legacy__' ? 'Без группы' : group || '—'

export function dateLabel(value) {
  const date = new Date(value)
  return value && Number.isFinite(date.valueOf()) ? dateFormat.format(date) : '—'
}

export function timeLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return value
  const date = new Date(value)
  return Number.isFinite(date.valueOf()) ? timeFormat.format(date) : value
}
