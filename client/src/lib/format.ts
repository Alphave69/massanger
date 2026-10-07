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

// Детерминированный оттенок серого для аватарки — контрастные пары
const SHADES = [
  { bg: '#ffffff', fg: '#000000', dark: false },
  { bg: '#d4d4d4', fg: '#000000', dark: false },
  { bg: '#9c9c9c', fg: '#000000', dark: false },
  { bg: '#3a3a3a', fg: '#ffffff', dark: true },
  { bg: '#000000', fg: '#ffffff', dark: true },
]

export function shadeFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return SHADES[Math.abs(h) % SHADES.length]
}

export const formatSince = (ts: number) => dateFmt.format(ts)

const pluralRules = new Intl.PluralRules('ru')

/** «1 участник», «3 участника», «5 участников» — forms: [один, несколько, много] */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const form = pluralRules.select(n)
  return `${n} ${form === 'one' ? one : form === 'few' ? few : many}`
}

export const MEMBERS: [string, string, string] = ['участник', 'участника', 'участников']
