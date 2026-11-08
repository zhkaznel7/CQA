export function statusLabel(status) {
  return { PENDING: 'На рассмотрении', ACCEPTED: 'Оценка изменена', REJECTED: 'Оценка подтверждена' }[status] ?? status
}

export function answerLabel(value) {
  if (value === true) return 'Да'
  if (value === false) return 'Нет'
  return value ?? 'N/A'
}
