import type { Presence, Status } from './api'

export const STATUS_LABEL: Record<Presence | 'invisible', string> = {
  online: 'В сети',
  idle: 'Не активен',
  sleep: 'Спит',
  dnd: 'Не беспокоить',
  invisible: 'Невидимка',
  offline: 'Не в сети',
}

export const STATUS_OPTIONS: { value: Status; hint: string }[] = [
  { value: 'online', hint: 'Все видят, что ты тут' },
  { value: 'idle', hint: 'Ставится сам, если долго не трогать мышь' },
  { value: 'sleep', hint: 'Ушёл спать — ответишь утром' },
  { value: 'dnd', hint: 'Без звуков и всплывающих уведомлений' },
  { value: 'invisible', hint: 'Для всех — не в сети, но ты всё видишь' },
]

/** Как показывать себя: невидимка у себя выглядит как «не в сети» */
export const selfPresence = (status: Status): Presence => (status === 'invisible' ? 'offline' : status)

export const isOnline = (p: Presence | undefined) => p !== undefined && p !== 'offline'
