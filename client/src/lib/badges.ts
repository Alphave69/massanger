import { create } from 'zustand'
import { api, type BadgeCatalog, type BadgeDef, type BadgeGroup, type BadgeTier } from './api'
import { blip, pulseSphere } from './fx'
import { useSettings } from './settings'
import { useChat } from './store'

/**
 * Значки: каталог (что бывает, у скольких есть, мой прогресс) и праздник при получении.
 * Каталог — с сервера (он главный), здесь только кэш и очередь «Новый значок!».
 */

export interface EarnedEvent {
  badge: BadgeDef
  at: number
}

interface BadgesState {
  catalog: BadgeCatalog | null
  /** Очередь праздников: показываем по одному */
  queue: EarnedEvent[]
  /** Последняя загрузка каталога не удалась */
  failed: boolean
}

export const useBadges = create<BadgesState>(() => ({ catalog: null, queue: [], failed: false }))

/** Через сколько каталог считается устаревшим (проценты и прогресс меняются) */
const STALE = 60_000

let loadedAt = 0
let inflight: Promise<void> | null = null

/** Подтянуть каталог значков с сервера (обновляет useBadges). force — даже если свежий */
export function loadBadges(force = false): Promise<void> {
  if (inflight) return inflight
  if (!force && useBadges.getState().catalog && Date.now() - loadedAt < STALE) return Promise.resolve()
  const meId = useChat.getState().me?.id
  inflight = api
    .badges()
    .then((catalog) => {
      // Пока грузили, могли выйти из аккаунта — чужой прогресс не сохраняем
      if (useChat.getState().me?.id !== meId) return
      loadedAt = Date.now()
      useBadges.setState({ catalog, failed: false })
    })
    .catch(() => {
      // сервер недоступен — покажем, что есть, попробуем в следующий раз
      useBadges.setState({ failed: true })
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Сервер прислал «значок получен» */
export function onBadgeEarned(e: EarnedEvent): void {
  if (!e?.badge) return
  useBadges.setState((s) =>
    s.queue.some((q) => q.badge.id === e.badge.id && q.at === e.at) ? s : { queue: [...s.queue, { badge: e.badge, at: e.at || Date.now() }] },
  )
  void blip()
  pulseSphere(e.badge.tier === 'legendary' ? 2.4 : 1.4)
  // Прогресс и «у скольких есть» поменялись
  if (useBadges.getState().catalog) void loadBadges(true)
}

/** Убрать показанный праздник из очереди */
export function shiftCelebration() {
  useBadges.setState((s) => ({ queue: s.queue.slice(1) }))
}

// Сменился аккаунт — чужой прогресс и праздники забываем
let lastMe: string | null = null
useChat.subscribe((st) => {
  const id = st.me?.id ?? null
  if (id === lastMe) return
  lastMe = id
  loadedAt = 0
  useBadges.setState({ catalog: null, queue: [], failed: false })
})

// ============ справочное ============

const defCache = new WeakMap<BadgeCatalog, Map<string, BadgeDef>>()

function defsOf(catalog: BadgeCatalog) {
  let map = defCache.get(catalog)
  if (!map) {
    map = new Map(catalog.badges.map((b) => [b.id, b]))
    defCache.set(catalog, map)
  }
  return map
}

/** Описание значка по id (из загруженного каталога) */
export function badgeDef(id: string, catalog: BadgeCatalog | null = useBadges.getState().catalog): BadgeDef | undefined {
  return catalog ? defsOf(catalog).get(id) : undefined
}

/** Значок, которого нет в каталоге (каталог устарел) — показываем хоть как-то */
export const unknownBadge = (id: string): BadgeDef => ({
  id,
  name: 'Значок',
  description: 'Об этом значке пока ничего не известно.',
  icon: 'sparkles',
  tier: 'common',
  group: 'special',
  secret: false,
  manual: false,
})

export const TIER_LABEL: Record<BadgeTier, string> = {
  common: 'Обычный',
  rare: 'Редкий',
  epic: 'Эпический',
  legendary: 'Легендарный',
}

/** Чем больше, тем ценнее */
export const TIER_RANK: Record<BadgeTier, number> = { common: 0, rare: 1, epic: 2, legendary: 3 }

export const GROUPS: { id: BadgeGroup; label: string }[] = [
  { id: 'time', label: 'Время' },
  { id: 'messages', label: 'Сообщения' },
  { id: 'voice', label: 'Голос' },
  { id: 'social', label: 'Друзья' },
  { id: 'eggs', label: 'Пасхалки' },
  { id: 'special', label: 'Особые' },
]

export interface Rarity {
  holders: number
  users: number
  /** Доля людей со значком, 0…100 */
  pct: number
}

/** held — значок точно у кого-то есть (каталог мог не успеть обновиться после получения) */
export function rarityOf(id: string, catalog: BadgeCatalog | null = useBadges.getState().catalog, held = false): Rarity | null {
  if (!catalog || !catalog.users) return null
  const holders = Math.max(catalog.holders[id] ?? 0, held ? 1 : 0)
  const users = Math.max(catalog.users, holders)
  return { holders, users, pct: (holders / users) * 100 }
}

/** «есть у 12% людей», «меньше чем у 1%»… mine — значок есть у того, кто смотрит */
export function rarityText(r: Rarity, mine = false) {
  if (r.holders === 0) return 'Пока ни у кого нет'
  if (r.holders === 1 && mine) return 'Есть только у тебя'
  if (r.holders >= r.users) return 'Есть у всех в Nuntius'
  if (r.pct < 1) return 'Есть меньше чем у 1% людей'
  return `Есть у ${Math.round(r.pct)}% людей`
}

/** Единицы прогресса там, где это не «штуки» (часы в голосе, минуты подряд, дни) */
const UNITS: Record<string, string> = {
  talker: ' ч',
  radio: ' ч',
  marathon: ' мин',
  week: ' дн.',
  month: ' дн.',
  halfyear: ' дн.',
  year: ' дн.',
  veteran: ' дн.',
}

export const progressUnit = (id: string) => UNITS[id] ?? ''

// ============ время в Nuntius ============

const dayStart = (ts: number) => {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Сколько календарных дней человек в Nuntius (0 — зарегистрировался сегодня) */
export const daysSince = (ts: number) => Math.max(0, Math.round((dayStart(Date.now()) - dayStart(ts)) / 86_400_000))

export const DAYS: [string, string, string] = ['день', 'дня', 'дней']

/** Меньше анимаций: настройка приложения или системная */
export function calmMotion() {
  if (useSettings.getState().reduceMotion) return true
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
