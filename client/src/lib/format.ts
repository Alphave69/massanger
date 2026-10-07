const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })

const startOfDay = (ts: number) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b)

export const formatTime = (ts: number) => timeFmt.format(ts)

export function formatStamp(ts: number) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000)
  if (days === 0) return `Сегодня в ${timeFmt.format(ts)}`
  if (days === 1) return `Вчера в ${timeFmt.format(ts)}`
  return `${shortDateFmt.format(ts)} ${timeFmt.format(ts)}`
}

export const formatDay = (ts: number) => dateFmt.format(ts)

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Детерминированный оттенок серого для аватарки
const SHADES = [
  { bg: '#ffffff', fg: '#000000' },
  { bg: '#d6d6d6', fg: '#000000' },
  { bg: '#9a9a9a', fg: '#000000' },
  { bg: '#5c5c5c', fg: '#ffffff' },
  { bg: '#2e2e2e', fg: '#ffffff' },
]

export function shadeFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return SHADES[Math.abs(h) % SHADES.length]
}
