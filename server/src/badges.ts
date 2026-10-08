import type { Server } from 'socket.io'
import * as store from './store.js'

/**
 * Значки и пасхалки.
 *
 * Большинство значков проверяются по сохранённому состоянию (sync): счётчики, стаж, друзья, пасхалки.
 * Некоторые даются за событие (award): первый заход в голос, камера, ночное сообщение и т.п.
 * Отнять значок может только админ (revoke).
 */

export type Tier = 'common' | 'rare' | 'epic' | 'legendary'
export type Group = 'time' | 'messages' | 'voice' | 'social' | 'eggs' | 'special'

export interface BadgeDef {
  id: string
  name: string
  description: string
  icon: string
  tier: Tier
  group: Group
  secret: boolean
  manual: boolean
}

const def = (id: string, name: string, description: string, icon: string, tier: Tier, group: Group, flags: { secret?: boolean; manual?: boolean } = {}): BadgeDef => ({
  id,
  name,
  description,
  icon,
  tier,
  group,
  secret: Boolean(flags.secret),
  manual: Boolean(flags.manual),
})

export const BADGES: BadgeDef[] = [
  // время
  def('beta', 'Бета-тестер', 'Был(а) в Nuntius ещё до официального запуска', 'flask-conical', 'epic', 'time'),
  def('founder', 'Основатель', 'Один(на) из первых десяти людей в Nuntius', 'gem', 'legendary', 'time'),
  def('first', 'Пользователь №1', 'Самый первый человек в Nuntius', 'crown', 'legendary', 'time', { secret: true }),
  def('week', 'Неделя с нами', '7 дней в Nuntius', 'calendar', 'common', 'time'),
  def('month', 'Месяц в эфире', '30 дней в Nuntius', 'calendar-days', 'common', 'time'),
  def('halfyear', 'Полгода', '182 дня в Nuntius', 'calendar-heart', 'rare', 'time'),
  def('year', 'Год вестей', 'Целый год в Nuntius', 'cake', 'epic', 'time'),
  def('veteran', 'Ветеран', 'Два года в Nuntius', 'medal', 'legendary', 'time'),
  // сообщения
  def('first-word', 'Первое слово', 'Отправил(а) первое сообщение', 'message-circle', 'common', 'messages'),
  def('chatty', 'Болтун', '100 сообщений', 'messages-square', 'common', 'messages'),
  def('orator', 'Оратор', '1 000 сообщений', 'megaphone', 'rare', 'messages'),
  def('cicero', 'Цицерон', '10 000 сообщений — «O tempora, o mores!»', 'scroll', 'legendary', 'messages'),
  def('owl', 'Сова', 'Писал(а) между 2 и 5 часами ночи', 'moon', 'rare', 'messages'),
  def('lark', 'Жаворонок', 'Писал(а) между 5 и 7 утра', 'sunrise', 'rare', 'messages'),
  def('friday13', 'Пятница, 13-е', 'Написал(а) в пятницу 13-го', 'skull', 'epic', 'messages', { secret: true }),
  def('fool', 'Первоапрельский', 'Написал(а) 1 апреля', 'party-popper', 'rare', 'messages', { secret: true }),
  def('newyear', 'Новогодний', 'Написал(а) в первый час нового года', 'snowflake', 'epic', 'messages', { secret: true }),
  // голос
  def('first-voice', 'В эфире', 'Впервые зашёл(ла) в голос', 'mic', 'common', 'voice'),
  def('talker', 'Не умолкает', '10 часов в голосе', 'audio-lines', 'rare', 'voice'),
  def('radio', 'Радиоведущий', '100 часов в голосе', 'radio', 'epic', 'voice'),
  def('marathon', 'Марафон', '3 часа в голосе подряд', 'timer', 'epic', 'voice'),
  def('caller', 'Звонарь', 'Начал(а) 10 звонков', 'phone-call', 'rare', 'voice'),
  def('camera', 'Перед камерой', 'Включил(а) камеру', 'video', 'common', 'voice'),
  def('director', 'Режиссёр', 'Показал(а) экран', 'monitor-up', 'common', 'voice'),
  // друзья
  def('friend', 'Есть контакт', 'Первый друг в Nuntius', 'handshake', 'common', 'social'),
  def('social', 'Душа компании', '10 друзей', 'users', 'rare', 'social'),
  def('architect', 'Архитектор', 'Создал(а) свой сервер', 'building', 'common', 'social'),
  def('gatherer', 'Собиратель', 'Создал(а) группу', 'users-round', 'common', 'social'),
  def('stylish', 'Стиляга', 'Заполнил(а) «о себе» и статус', 'sparkles', 'common', 'social'),
  // пасхалки
  def('curious', 'Любопытный', 'Нашёл(ла) первую пасхалку', 'egg', 'common', 'eggs'),
  def('seeker', 'Искатель', 'Нашёл(ла) 5 пасхалок', 'search', 'rare', 'eggs'),
  def('archaeologist', 'Археолог', 'Нашёл(ла) все пасхалки', 'pickaxe', 'legendary', 'eggs'),
  // особые
  def('creator', 'Хозяин лобби', 'Владелец общего сервера Nuntius', 'castle', 'legendary', 'special'),
  def('palindrome', 'Палиндром', 'Логин читается одинаково с обеих сторон', 'repeat', 'rare', 'special', { secret: true }),
  // выдаёт админ
  def('staff', 'Команда Nuntius', 'Делает Nuntius', 'shield-check', 'legendary', 'special', { manual: true }),
  def('moderator', 'Модератор', 'Следит за порядком', 'gavel', 'epic', 'special', { manual: true }),
  def('tester', 'Тестировщик', 'Помогает ловить баги', 'bug', 'epic', 'special', { manual: true }),
  def('bughunter', 'Охотник на баги', 'Нашёл(ла) настоящий баг', 'bug-off', 'epic', 'special', { manual: true }),
  def('vip', 'VIP', 'Очень важная персона', 'star', 'epic', 'special', { manual: true }),
  def('friend-of-dev', 'Друг разработчика', 'Лично знаком(а) с создателем', 'heart-handshake', 'rare', 'special', { manual: true }),
  def('legend', 'Легенда', 'Это легенда. Просто легенда.', 'flame', 'legendary', 'special', { manual: true }),
  def('artist', 'Художник', 'Рисует, монтирует, творит', 'palette', 'rare', 'special', { manual: true }),
]

/** Пасхалки: id ищет клиент, названия и проверка — здесь */
export const EGGS: { id: string; name: string }[] = [
  { id: 'konami', name: 'Код Konami' },
  { id: 'sphere', name: 'Не трогай сферу' },
  { id: 'barrel', name: 'Бочка' },
  { id: 'answer', name: '42' },
  { id: 'latin', name: 'Вестник' },
  { id: 'night', name: 'Полуночник' },
  { id: 'dizzy', name: 'Голова кружится' },
  { id: 'developer', name: 'Разработчик' },
  { id: 'hacker', name: 'Хакер' },
  { id: 'indecisive', name: 'Определись уже' },
  { id: 'loud', name: 'Громче некуда' },
  { id: 'commands', name: 'Командир' },
  { id: 'poem', name: 'Поэт' },
  { id: 'origin', name: 'Начало начал' },
  { id: 'zoom', name: 'Лупа' },
  { id: 'shortcuts', name: 'Горячие клавиши' },
  { id: 'mirror', name: 'Зазеркалье' },
  { id: 'echo', name: 'Эхо' },
  { id: 'clicker', name: 'Кнопочник' },
]

const DAY = 86_400_000
const HOUR = 3600

const TIER_RANK: Record<Tier, number> = { legendary: 3, epic: 2, rare: 1, common: 0 }
const byId = new Map(BADGES.map((b) => [b.id, b]))
export const badgeDef = (id: string) => byId.get(id)

// В профиле значки идут от редких к обычным
store.setBadgeRank((id) => TIER_RANK[byId.get(id)?.tier ?? 'common'])

/** До этой даты все новые люди — бета-тестеры */
const betaUntil = () => {
  const t = Date.parse(process.env.NUNTIUS_BETA_UNTIL ?? '2027-01-01')
  return Number.isNaN(t) ? Date.parse('2027-01-01') : t
}

/** Пороги значков-счётчиков: [id, сколько нужно] */
const MESSAGES: [string, number][] = [
  ['first-word', 1],
  ['chatty', 100],
  ['orator', 1000],
  ['cicero', 10000],
]
const VOICE_HOURS: [string, number][] = [
  ['talker', 10],
  ['radio', 100],
]
const TENURE_DAYS: [string, number][] = [
  ['week', 7],
  ['month', 30],
  ['halfyear', 182],
  ['year', 365],
  ['veteran', 730],
]
const FRIENDS: [string, number][] = [
  ['friend', 1],
  ['social', 10],
]
const EGG_COUNTS: [string, number][] = [
  ['curious', 1],
  ['seeker', 5],
  ['archaeologist', EGGS.length],
]
const MARATHON_MINUTES = 180
const CALLS_NEEDED = 10

/** Местное время человека (tz — как Date.getTimezoneOffset: местное = UTC − tz) */
export function localTime(tz: number | null, at = Date.now()) {
  const d = new Date(at - (tz ?? 0) * 60_000)
  return { hour: d.getUTCHours(), date: d.getUTCDate(), month: d.getUTCMonth() + 1, weekday: d.getUTCDay() }
}

const friendsCount = (userId: string) => store.relationsOf(userId).filter((r) => r.state === 'friends').length
const tenureDays = (user: store.User) => Math.floor((Date.now() - user.createdAt) / DAY)
const isPalindrome = (s: string) => {
  const t = s.toLowerCase().replace(/[_.]/g, '')
  return t.length >= 3 && t === [...t].reverse().join('')
}

export interface FoundEgg {
  id: string
  name: string
  at: number
}

export const eggsOf = (user: store.User): FoundEgg[] =>
  Object.entries(user.eggs)
    .map(([id, at]) => ({ id, name: EGGS.find((e) => e.id === id)?.name ?? id, at }))
    .sort((a, b) => a.at - b.at)

/**
 * @param changed — вызывается, когда у человека поменялись значки или пасхалки
 *   (index.ts рассылает обновлённый профиль ему и остальным)
 */
export function createBadges(io: Server, changed: (user: store.User) => void) {
  /** Выдать значок; true — если он новый. Сам «праздник» видит только получатель */
  function give(user: store.User, id: string) {
    const badge = byId.get(id)
    if (!badge || user.badges[id]) return false
    const at = Date.now()
    user.badges[id] = at
    io.to(`user:${user.id}`).emit('badge:earned', { badge, at })
    return true
  }

  function finish(user: store.User, any: boolean) {
    if (!any) return
    store.persist()
    changed(user)
  }

  /** Всё, что можно проверить по сохранённому состоянию */
  function sync(user: store.User) {
    const want: string[] = []
    if (user.createdAt < betaUntil()) want.push('beta')
    const n = store.userNumber(user.id)
    if (n >= 1 && n <= 10) want.push('founder')
    if (n === 1) want.push('first')
    if (store.allGuilds().some((g) => g.isLobby && g.ownerId === user.id)) want.push('creator')
    if (isPalindrome(user.username)) want.push('palindrome')
    if (user.bio.trim() && user.customStatus.trim()) want.push('stylish')
    const days = tenureDays(user)
    for (const [id, need] of TENURE_DAYS) if (days >= need) want.push(id)
    for (const [id, need] of MESSAGES) if (user.stats.messages >= need) want.push(id)
    for (const [id, need] of VOICE_HOURS) if (user.stats.voiceSeconds >= need * HOUR) want.push(id)
    if (user.stats.longestVoice >= MARATHON_MINUTES * 60) want.push('marathon')
    if (user.stats.calls >= CALLS_NEEDED) want.push('caller')
    const friends = friendsCount(user.id)
    for (const [id, need] of FRIENDS) if (friends >= need) want.push(id)
    const eggs = Object.keys(user.eggs).length
    for (const [id, need] of EGG_COUNTS) if (eggs >= need) want.push(id)
    let any = false
    for (const id of want) any = give(user, id) || any
    finish(user, any)
  }

  /** Значок за событие */
  function award(user: store.User | undefined, id: string) {
    if (user) finish(user, give(user, id))
  }

  const withUser = (userId: string, fn: (u: store.User) => void) => {
    const user = store.findUser(userId)
    if (user) fn(user)
  }

  return {
    sync,
    award,
    syncId: (userId: string) => withUser(userId, sync),

    /** Отправил сообщение: счётчик и «время суток» по его часовому поясу */
    onMessage(user: store.User, at: number) {
      user.stats.messages++
      const t = localTime(user.tz, at)
      const extra: string[] = []
      if (user.tz !== null && t.hour >= 2 && t.hour < 5) extra.push('owl')
      if (user.tz !== null && t.hour >= 5 && t.hour < 7) extra.push('lark')
      if (t.weekday === 5 && t.date === 13) extra.push('friday13')
      if (t.month === 4 && t.date === 1) extra.push('fool')
      if (t.month === 1 && t.date === 1 && t.hour === 0) extra.push('newyear')
      let any = false
      for (const id of extra) any = give(user, id) || any
      finish(user, any)
      sync(user) // пороги «Болтун», «Оратор»… (сохранит и счётчик)
      store.persist()
    },

    /** Голос: зашёл, посидел (секунды), начал звонок, включил камеру / экран */
    onVoiceJoin: (userId: string) => withUser(userId, (u) => award(u, 'first-voice')),
    onVoiceSession: (userId: string, seconds: number) =>
      withUser(userId, (u) => {
        if (seconds <= 0) return
        u.stats.voiceSeconds += seconds
        u.stats.longestVoice = Math.max(u.stats.longestVoice, seconds)
        store.persist()
        sync(u)
      }),
    onCall: (userId: string) =>
      withUser(userId, (u) => {
        u.stats.calls++
        store.persist()
        sync(u)
      }),
    onMedia: (userId: string, kind: 'video' | 'screen') => withUser(userId, (u) => award(u, kind === 'video' ? 'camera' : 'director')),

    /**
     * Нашёл пасхалку. server — засчитал сам сервер (например, за команду): тогда шлём egg:found,
     * чтобы клиент показал уведомление.
     */
    findEgg(user: store.User, id: string, server = false): { isNew: boolean; egg: FoundEgg } | null {
      const egg = EGGS.find((e) => e.id === id)
      if (!egg) return null
      if (user.eggs[id]) return { isNew: false, egg: { ...egg, at: user.eggs[id] } }
      const at = Date.now()
      user.eggs[id] = at
      store.persist()
      if (server) io.to(`user:${user.id}`).emit('egg:found', { egg: { ...egg, at }, count: Object.keys(user.eggs).length, total: EGGS.length })
      sync(user)
      changed(user)
      return { isNew: true, egg: { ...egg, at } }
    },

    /** Админ выдал / забрал значок */
    grant(user: store.User, id: string) {
      if (!byId.has(id)) return false
      finish(user, give(user, id))
      return true
    },
    revoke(user: store.User, id: string) {
      if (!user.badges[id]) return false
      delete user.badges[id]
      store.persist()
      changed(user)
      return true
    },

    /** Каталог для человека: секретные неполученные — «???», плюс редкость и его прогресс */
    catalogFor(user: store.User) {
      const users = store.allUsers()
      const holders: Record<string, number> = {}
      for (const u of users) for (const id of Object.keys(u.badges)) holders[id] = (holders[id] ?? 0) + 1
      const badges = BADGES.map((b) =>
        b.secret && !user.badges[b.id] ? { ...b, name: '???', description: 'Секретный значок. Как получить — загадка.', icon: 'help-circle' } : b,
      )
      const progress: Record<string, { current: number; target: number }> = {}
      const days = tenureDays(user)
      for (const [id, need] of TENURE_DAYS) progress[id] = { current: Math.min(days, need), target: need }
      for (const [id, need] of MESSAGES) progress[id] = { current: Math.min(user.stats.messages, need), target: need }
      for (const [id, need] of VOICE_HOURS) progress[id] = { current: Math.min(Math.floor(user.stats.voiceSeconds / HOUR), need), target: need }
      progress.marathon = { current: Math.min(Math.floor(user.stats.longestVoice / 60), MARATHON_MINUTES), target: MARATHON_MINUTES }
      progress.caller = { current: Math.min(user.stats.calls, CALLS_NEEDED), target: CALLS_NEEDED }
      const friends = friendsCount(user.id)
      for (const [id, need] of FRIENDS) progress[id] = { current: Math.min(friends, need), target: need }
      const eggs = Object.keys(user.eggs).length
      for (const [id, need] of EGG_COUNTS) progress[id] = { current: Math.min(eggs, need), target: need }
      return { badges, holders, users: users.length, eggTotal: EGGS.length, progress }
    },
  }
}

export type Badges = ReturnType<typeof createBadges>
