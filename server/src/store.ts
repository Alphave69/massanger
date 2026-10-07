import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

export interface User {
  id: string
  username: string
  displayName: string
  passwordHash: string
  createdAt: number
  status: Status
  customStatus: string
  bio: string
  privacy: Privacy
  /** Растёт при смене пароля / «выйти везде» — старые токены перестают работать */
  tokenVersion: number
}

export interface Channel {
  id: string
  name: string
  type: 'text' | 'voice'
}

export interface Guild {
  id: string
  name: string
  ownerId: string
  channels: Channel[]
  memberIds: string[]
  createdAt: number
}

/** Связь между двумя людьми: заявка в друзья или уже дружба */
export interface Relation {
  id: string
  from: string
  to: string
  state: 'pending' | 'friends'
  createdAt: number
}

/** Личная переписка двух людей */
export interface Dm {
  id: string
  memberIds: [string, string]
  createdAt: number
  lastMessageAt: number
}

export interface Message {
  id: string
  channelId: string
  authorId: string
  content: string
  createdAt: number
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
      privacy: { ...DEFAULT_PRIVACY, ...u.privacy },
      tokenVersion: u.tokenVersion ?? 0,
    })),
    // общий сервер переименован вместе с приложением
    guilds: (raw.guilds ?? []).map((g, i) => (i === 0 && g.name === 'Massanger' ? { ...g, name: 'Nuntius' } : g)),
    relations: raw.relations ?? [],
    dms: raw.dms ?? [],
    messages: raw.messages ?? [],
  }
}

const data = load()

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

export function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    customStatus: u.customStatus,
    bio: u.bio,
    createdAt: u.createdAt,
  }
}
export type PublicUser = ReturnType<typeof publicUser>

// --- users ---

export const findUserByName = (username: string) =>
  data.users.find((u) => u.username.toLowerCase() === username.toLowerCase())

export const findUser = (userId: string) => data.users.find((u) => u.id === userId)

export function createUser(u: Pick<User, 'username' | 'displayName' | 'passwordHash'>): User {
  const user: User = {
    ...u,
    id: id(),
    createdAt: Date.now(),
    status: 'online',
    customStatus: '',
    bio: '',
    privacy: { ...DEFAULT_PRIVACY },
    tokenVersion: 0,
  }
  data.users.push(user)
  // Все новые пользователи сразу попадают на общий сервер
  ensureLobby(user.id).memberIds.push(user.id)
  save()
  return user
}

export type UserPatch = Partial<Pick<User, 'username' | 'displayName' | 'status' | 'customStatus' | 'bio' | 'privacy' | 'passwordHash' | 'tokenVersion'>>

export function updateUser(user: User, patch: UserPatch) {
  Object.assign(user, patch)
  save()
}

// --- guilds ---

function defaultChannels(): Channel[] {
  return [
    { id: id(), name: 'общий', type: 'text' },
    { id: id(), name: 'мемы', type: 'text' },
    { id: id(), name: 'Голосовой', type: 'voice' },
  ]
}

function ensureLobby(ownerId: string): Guild {
  let lobby = data.guilds[0]
  if (!lobby) {
    lobby = { id: id(), name: 'Nuntius', ownerId, channels: defaultChannels(), memberIds: [], createdAt: Date.now() }
    data.guilds.push(lobby)
  }
  return lobby
}

export const findGuild = (guildId: string) => data.guilds.find((g) => g.id === guildId)

export const guildsOf = (userId: string) => data.guilds.filter((g) => g.memberIds.includes(userId))

export function createGuild(name: string, ownerId: string): Guild {
  const guild: Guild = { id: id(), name, ownerId, channels: defaultChannels(), memberIds: [ownerId], createdAt: Date.now() }
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
  let dm = data.dms.find((d) => d.memberIds.includes(a) && d.memberIds.includes(b))
  if (!dm) {
    dm = { id: id(), memberIds: [a, b], createdAt: Date.now(), lastMessageAt: 0 }
    data.dms.push(dm)
    save()
  }
  return dm
}

// --- каналы: общий доступ к серверным каналам и личкам ---

export type ChannelAccess = { kind: 'guild'; guild: Guild; channel: Channel } | { kind: 'dm'; dm: Dm }

export function channelAccess(channelId: string, userId: string): ChannelAccess | undefined {
  const dm = findDm(channelId)
  if (dm) return dm.memberIds.includes(userId) ? { kind: 'dm', dm } : undefined
  for (const guild of data.guilds) {
    const channel = guild.channels.find((c) => c.id === channelId)
    if (channel) return guild.memberIds.includes(userId) ? { kind: 'guild', guild, channel } : undefined
  }
  return undefined
}

// --- messages ---

export function messagesIn(channelId: string, limit = 150): Message[] {
  return data.messages.filter((m) => m.channelId === channelId).slice(-limit)
}

/** Автор служебных сообщений («теперь вы друзья» и т.п.) */
export const SYSTEM_AUTHOR = 'system'

export function addMessage(channelId: string, authorId: string, content: string): Message {
  const message: Message = { id: id(), channelId, authorId, content, createdAt: Date.now() }
  data.messages.push(message)
  const dm = findDm(channelId)
  if (dm) dm.lastMessageAt = message.createdAt
  save()
  return message
}
