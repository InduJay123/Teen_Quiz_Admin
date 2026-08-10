export function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export function percent(value) {
  const n = Number(value || 0)
  return `${Math.round(n)}%`
}

export function titleFromKey(value = '') {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function scoreTone(score) {
  const n = Number(score || 0)
  if (n >= 80) return 'good'
  if (n >= 60) return 'mid'
  return 'bad'
}
