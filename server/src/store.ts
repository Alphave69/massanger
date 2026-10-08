import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canView, DEFAULT_EVERYONE, isPermission, type Permission } from './permissions.js'

// Простое хранилище в JSON-файле. Для компании друзей хватит с запасом;
// когда понадобится — заменим на SQLite/Postgres, не трогая остальной код.

export const STATUSES = ['online', 'idle', 'sleep', 'dnd', 'invisible'] as const
export type Status = (typeof STATUSES)[number]

export interface Privacy {
  /** Кто может писать в личку: друзья и люди с общих серверов — или только друзья */
  dms: 'servers' | 'friends'
  /** Кто может отправлять заявки в друзья */
  friendRequests: 'everyone' | 'nobody'
}

export const DEFAULT_PRIVACY: Privacy = { dms: 'servers', friendRequests: 'everyone' }

/** Счётчики для значков */
export interface UserStats {
  messages: number
  /** Сколько всего просидел в голосе (секунды) */
  voiceSeconds: number
  /** Самая длинная сессия в голосе (секунды) */
  longestVoice: number
  /** Сколько раз начинал звонок в личке/группе */
  calls: number
  /** Сколько раз пользовался командами (/roll и т.п.) */
  commands: number
}

export const EMPTY_STATS: UserStats = { messages: 0, voiceSeconds: 0, longestVoice: 0, calls: 0, commands: 0 }

/** Что разрешено человеку во всём приложении (меняет админ) */
export interface Privileges {
  /** Может создавать свои серверы */
  createServers: boolean
  /** Может создавать группы */
  createGroups: boolean
}

export const DEFAULT_PRIVILEGES: Privileges = { createServers: true, createGroups: true }

export interface User {
  id: string
  username: string
  displayName: string
  /** Подтверждённая почта (в нижнем регистре) или null у старых аккаунтов */
  email: string | null
  passwordHash: string
  createdAt: number
  status: Status
  customStatus: string
  bio: string
  privacy: Privacy
  /** Растёт при смене пароля / «выйти везде» — старые токены перестают работать */
  tokenVersion: number

  // --- значки и пасхалки ---
  stats: UserStats
  /** id значка → когда получен */
  badges: Record<string, number>
  /** id пасхалки → когда найдена */
  eggs: Record<string, number>
  /** Смещение часового пояса в минутах (как Date.getTimezoneOffset) — для «Совы» и т.п.; null — неизвестно */
  tz: number | null

  // --- админка ---
  /** «Галочка» у имени — подтверждённый человек */
  verified: boolean
  /** Доступ к админке приложения (владелец приложения — админ всегда) */
  admin: boolean
  /** Заблокирован: не может войти, все сессии закрыты */
  banned: boolean
  privileges: Privileges
}

/** Исключения для роли в конкретном канале */
export interface Override {
  allow: Permission[]
  deny: Permission[]
}

export interface Channel {
  id: string
  name: string
  type: 'text' | 'voice'
  /** id роли → исключения в этом канале (роль @everyone — id сервера) */
  overrides: Record<string, Override>
}

export interface Role {
  id: string
  name: string
  /** Цвет имени ('#rrggbb') или null — без цвета */
  color: string | null
  /** Показывать участников с этой ролью отдельной группой в списке */
  hoist: boolean
  permissions: Permission[]
  /** Чем больше, тем выше роль (у @everyone — 0) */
  position: number
}

export interface Guild {
  id: string
  name: string
  ownerId: string
  channels: Channel[]
  memberIds: string[]
  createdAt: number
  /** Общий сервер, куда попадают все новые люди: его нельзя удалить */
  isLobby?: boolean
  /** Роли сервера; первая — @everyone (id = id сервера) */
  roles: Role[]
  /** id участника → id его ролей (кроме @everyone) */
  memberRoles: Record<string, string[]>
}

/** Связь между двумя людьми: заявка в друзья или уже дружба */
export interface Relation {
  id: string
  from: string
  to: string
  state: 'pending' | 'friends'
  createdAt: number
}

/** Личная переписка двух людей (dm) или группа из нескольких (group) */
export interface Dm {
  id: string
  kind: 'dm' | 'group'
  memberIds: string[]
  /** Название группы ('' — показываем имена участников) */
  name: string
  /** Создатель группы (у лички — null) */
  ownerId: string | null
  createdAt: number
  lastMessageAt: number
}

export const GROUP_LIMIT = 10

/** Особый вид сообщения — результат команды (/roll, /flip, /8ball, /me) */
export type MessageFlavor = 'roll' | 'flip' | 'ball' | 'me'

export interface Message {
  id: string
  channelId: string
  authorId: string
  content: string
  createdAt: number
  flavor?: MessageFlavor
}

interface Data {
  users: User[]
  guilds: Guild[]
  relations: Relation[]
  dms: Dm[]
  messages: Message[]
}

const DATA_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../data/db.json')

function load(): Data {
  const raw: Partial<Data> = existsSync(DATA_FILE) ? JSON.parse(readFileSync(DATA_FILE, 'utf8')) : {}
  // Дозаполняем поля, которых не было в старых версиях файла
  return {
    users: (raw.users ?? []).map((u) => ({
      ...u,
      status: u.status ?? 'online',
      customStatus: u.customStatus ?? '',
      bio: u.bio ?? '',
      email: u.email ?? null,
      privacy: { ...DEFAULT_PRIVACY, ...u.privacy },
      tokenVersion: u.tokenVersion ?? 0,
      stats: { ...EMPTY_STATS, ...u.stats },
      badges: u.badges ?? {},
      eggs: u.eggs ?? {},
      tz: typeof u.tz === 'number' ? u.tz : null,
      verified: u.verified ?? false,
      admin: u.admin ?? false,
      banned: u.banned ?? false,
      privileges: { ...DEFAULT_PRIVILEGES, ...u.privileges },
    })),
    // общий сервер переименован вместе с приложением
    guilds: migrateGuilds(raw.guilds ?? []),
    relations: raw.relations ?? [],
    dms: (raw.dms ?? []).map((d) => ({ ...d, kind: d.kind ?? 'dm', name: d.name ?? '', ownerId: d.ownerId ?? null })),
    messages: raw.messages ?? [],
  }
}

function migrateGuilds(guilds: Guild[]): Guild[] {
  // общий сервер переименован вместе с приложением и помечен флагом (раньше им был просто первый)
  const hasLobby = guilds.some((g) => g.isLobby)
  return guilds.map((g, i) => {
    const lobby = g.isLobby || (!hasLobby && i === 0)
    // роли появились позже: у старых серверов есть только @everyone с правами по умолчанию
    const roles = g.roles?.length ? g.roles : [everyoneRole(g.id)]
    return {
      ...g,
      isLobby: lobby || undefined,
      name: lobby && g.name === 'Massanger' ? 'Nuntius' : g.name,
      roles: roles.map((r) => ({ ...r, permissions: (r.permissions ?? []).filter(isPermission) })),
      memberRoles: g.memberRoles ?? {},
      channels: g.channels.map((c) => ({ ...c, overrides: c.overrides ?? {} })),
    }
  })
}

/** Роль @everyone: есть у всех участников, её id совпадает с id сервера */
export const everyoneRole = (guildId: string): Role => ({
  id: guildId,
  name: '@everyone',
  color: null,
  hoist: false,
  permissions: [...DEFAULT_EVERYONE],
  position: 0,
})

const data = load()

/** Сохранить изменения, сделанные прямо в объектах (переименования и т.п.) */
export const persist = () => save()

let saveTimer: NodeJS.Timeout | null = null
function save() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    mkdirSync(dirname(DATA_FILE), { recursive: true })
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
  }, 200)
}

export const id = () => randomUUID()

/** Редкость значка для сортировки (задаёт badges.ts, чтобы store не зависел от каталога) */
let badgeRank: (id: string) => number = () => 0
export const setBadgeRank = (fn: (id: string) => number) => {
  badgeRank = fn
}

export function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    customStatus: u.customStatus,
    bio: u.bio,
    createdAt: u.createdAt,
    /** «Галочка» у имени */
    verified: u.verified,
    /** Номер регистрации: «пользователь №7» */
    number: userNumber(u.id),
    /** Полученные значки: сначала редкие, внутри — по времени получения */
    badges: Object.entries(u.badges)
      .map(([id, at]) => ({ id, at }))
      .sort((a, b) => badgeRank(b.id) - badgeRank(a.id) || a.at - b.at),
  }
}
export type PublicUser = ReturnType<typeof publicUser>

// --- users ---

export const findUserByName = (username: string) =>
  data.users.find((u) => u.username.toLowerCase() === username.toLowerCase())

export const findUser = (userId: string) => data.users.find((u) => u.id === userId)

export const findUserByEmail = (email: string) => data.users.find((u) => u.email === email.trim().toLowerCase())

export function createUser(u: Pick<User, 'username' | 'displayName' | 'passwordHash' | 'email'>): User {
  const user: User = {
    ...u,
    id: id(),
    createdAt: Date.now(),
    status: 'online',
    customStatus: '',
    bio: '',
    privacy: { ...DEFAULT_PRIVACY },
    tokenVersion: 0,
    stats: { ...EMPTY_STATS },
    badges: {},
    eggs: {},
    tz: null,
    verified: false,
    admin: false,
    banned: false,
    privileges: { ...DEFAULT_PRIVILEGES },
  }
  data.users.push(user)
  // Все новые пользователи сразу попадают на общий сервер
  ensureLobby(user.id).memberIds.push(user.id)
  save()
  return user
}

export type UserPatch = Partial<
  Pick<
    User,
    | 'username'
    | 'displayName'
    | 'email'
    | 'status'
    | 'customStatus'
    | 'bio'
    | 'privacy'
    | 'passwordHash'
    | 'tokenVersion'
    | 'tz'
    | 'verified'
    | 'admin'
    | 'banned'
    | 'privileges'
  >
>

export function updateUser(user: User, patch: UserPatch) {
  Object.assign(user, patch)
  save()
}

// --- guilds ---

function defaultChannels(): Channel[] {
  return [
    { id: id(), name: 'общий', type: 'text', overrides: {} },
    { id: id(), name: 'мемы', type: 'text', overrides: {} },
    { id: id(), name: 'Голосовой', type: 'voice', overrides: {} },
  ]
}

function newGuild(name: string, ownerId: string, memberIds: string[], isLobby?: true): Guild {
  const guildId = id()
  return {
    id: guildId,
    name,
    ownerId,
    channels: defaultChannels(),
    memberIds,
    createdAt: Date.now(),
    isLobby,
    roles: [everyoneRole(guildId)],
    memberRoles: {},
  }
}

function ensureLobby(ownerId: string): Guild {
  let lobby = data.guilds.find((g) => g.isLobby)
  if (!lobby) {
    lobby = newGuild('Nuntius', ownerId, [], true)
    data.guilds.push(lobby)
  }
  return lobby
}

export const findGuild = (guildId: string) => data.guilds.find((g) => g.id === guildId)

export const allGuilds = () => data.guilds

export const guildsOf = (userId: string) => data.guilds.filter((g) => g.memberIds.includes(userId))

export function createGuild(name: string, ownerId: string): Guild {
  const guild = newGuild(name, ownerId, [ownerId])
  data.guilds.push(guild)
  save()
  return guild
}

export function joinGuild(guildId: string, userId: string): Guild | undefined {
  const guild = findGuild(guildId)
  if (!guild) return undefined
  if (!guild.memberIds.includes(userId)) {
    guild.memberIds.push(userId)
    save()
  }
  return guild
}

/** Удалить сервер вместе с сообщениями его каналов */
export function deleteGuild(guild: Guild) {
  const channelIds = new Set(guild.channels.map((c) => c.id))
  data.guilds = data.guilds.filter((g) => g !== guild)
  data.messages = data.messages.filter((m) => !channelIds.has(m.channelId))
  save()
}

export function addChannel(guild: Guild, name: string, type: Channel['type']): Channel {
  const channel: Channel = { id: id(), name, type, overrides: {} }
  guild.channels.push(channel)
  save()
  return channel
}

export function removeChannel(guild: Guild, channelId: string) {
  guild.channels = guild.channels.filter((c) => c.id !== channelId)
  data.messages = data.messages.filter((m) => m.channelId !== channelId)
  save()
}

export function removeGuildMember(guild: Guild, userId: string) {
  guild.memberIds = guild.memberIds.filter((id) => id !== userId)
  delete guild.memberRoles[userId]
  save()
}

export const shareGuild = (a: string, b: string) =>
  data.guilds.some((g) => g.memberIds.includes(a) && g.memberIds.includes(b))

// --- друзья ---

export const relationBetween = (a: string, b: string) =>
  data.relations.find((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a))

export const relationsOf = (userId: string) => data.relations.filter((r) => r.from === userId || r.to === userId)

export const areFriends = (a: string, b: string) => relationBetween(a, b)?.state === 'friends'

export function addRelation(from: string, to: string): Relation {
  const relation: Relation = { id: id(), from, to, state: 'pending', createdAt: Date.now() }
  data.relations.push(relation)
  save()
  return relation
}

export function acceptRelation(relation: Relation) {
  relation.state = 'friends'
  save()
}

export function removeRelation(relation: Relation) {
  data.relations = data.relations.filter((r) => r !== relation)
  save()
}

// --- личные сообщения ---

export const findDm = (dmId: string) => data.dms.find((d) => d.id === dmId)

export const dmsOf = (userId: string) => data.dms.filter((d) => d.memberIds.includes(userId))

export function openDm(a: string, b: string): Dm {
  let dm = data.dms.find((d) => d.kind === 'dm' && d.memberIds.includes(a) && d.memberIds.includes(b))
  if (!dm) {
    dm = { id: id(), kind: 'dm', memberIds: [a, b], name: '', ownerId: null, createdAt: Date.now(), lastMessageAt: 0 }
    data.dms.push(dm)
    save()
  }
  return dm
}

export function createGroup(ownerId: string, memberIds: string[], name: string): Dm {
  const now = Date.now()
  const group: Dm = { id: id(), kind: 'group', memberIds: [ownerId, ...memberIds], name, ownerId, createdAt: now, lastMessageAt: now }
  data.dms.push(group)
  save()
  return group
}

/** Удалить переписку целиком (группа опустела) */
export function deleteDm(dm: Dm) {
  data.dms = data.dms.filter((d) => d !== dm)
  data.messages = data.messages.filter((m) => m.channelId !== dm.id)
  save()
}

// --- каналы: общий доступ к серверным каналам и личкам ---

export type ChannelAccess = { kind: 'guild'; guild: Guild; channel: Channel } | { kind: 'dm'; dm: Dm }

/** Где находится канал — без проверки, кто спрашивает (для админки и рассылок) */
export function locateChannel(channelId: string): ChannelAccess | undefined {
  const dm = findDm(channelId)
  if (dm) return { kind: 'dm', dm }
  for (const guild of data.guilds) {
    const channel = guild.channels.find((c) => c.id === channelId)
    if (channel) return { kind: 'guild', guild, channel }
  }
  return undefined
}

/** Видит ли человек канал: участник лички — или участник сервера с правом VIEW_CHANNEL */
export const canSee = (access: ChannelAccess, userId: string) =>
  access.kind === 'dm' ? access.dm.memberIds.includes(userId) : canView(access.guild, access.channel, userId)

/** Кто видит канал (им и уходят его события) */
export const viewersOf = (access: ChannelAccess) =>
  access.kind === 'dm' ? access.dm.memberIds : access.guild.memberIds.filter((id) => canView(access.guild, access.channel, id))

/** Канал, если человек его видит (серверный — только с правом VIEW_CHANNEL) */
export function channelAccess(channelId: string, userId: string): ChannelAccess | undefined {
  const access = locateChannel(channelId)
  return access && canSee(access, userId) ? access : undefined
}

// --- messages ---

/** Писал ли человек в этот канал хоть раз */
export const hasWritten = (channelId: string, userId: string) => data.messages.some((m) => m.channelId === channelId && m.authorId === userId)

export function messagesIn(channelId: string, limit = 150): Message[] {
  return data.messages.filter((m) => m.channelId === channelId).slice(-limit)
}

/** Автор служебных сообщений («теперь вы друзья» и т.п.) */
export const SYSTEM_AUTHOR = 'system'

export function addMessage(channelId: string, authorId: string, content: string, flavor?: MessageFlavor): Message {
  const message: Message = { id: id(), channelId, authorId, content, createdAt: Date.now(), ...(flavor ? { flavor } : {}) }
  data.messages.push(message)
  const dm = findDm(channelId)
  if (dm) dm.lastMessageAt = message.createdAt
  save()
  return message
}

export const findMessage = (messageId: string) => data.messages.find((m) => m.id === messageId)

export function deleteMessage(message: Message) {
  data.messages = data.messages.filter((m) => m !== message)
  save()
}

// --- для значков и админки ---

export const allUsers = () => data.users

/** Порядковый номер регистрации: 1 — самый первый человек в Nuntius */
export const userNumber = (userId: string) => data.users.findIndex((u) => u.id === userId) + 1

/**
 * Владелец приложения: логин из NUNTIUS_OWNER в .env, иначе — самый первый зарегистрированный.
 * Он всегда админ, и снять это нельзя.
 */
export function isAppOwner(user: User) {
  const owner = process.env.NUNTIUS_OWNER?.trim().replace(/^@/, '').toLowerCase()
  return owner ? user.username.toLowerCase() === owner : data.users[0]?.id === user.id
}

export const isAdmin = (user: User) => user.admin || isAppOwner(user)

export const counts = () => ({
  users: data.users.length,
  guilds: data.guilds.length,
  groups: data.dms.filter((d) => d.kind === 'group').length,
  dms: data.dms.filter((d) => d.kind === 'dm').length,
  messages: data.messages.length,
})
