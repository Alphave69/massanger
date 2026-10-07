import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Простое хранилище в JSON-файле. Для компании друзей хватит с запасом;
// когда понадобится — заменим на SQLite/Postgres, не трогая остальной код.

export interface User {
  id: string
  username: string
  displayName: string
  passwordHash: string
  createdAt: number
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
  messages: Message[]
}

const DATA_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../data/db.json')

function load(): Data {
  if (!existsSync(DATA_FILE)) return { users: [], guilds: [], messages: [] }
  return JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Data
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
  return { id: u.id, username: u.username, displayName: u.displayName }
}
export type PublicUser = ReturnType<typeof publicUser>

// --- users ---

export const findUserByName = (username: string) =>
  data.users.find((u) => u.username.toLowerCase() === username.toLowerCase())

export const findUser = (userId: string) => data.users.find((u) => u.id === userId)

export function createUser(u: Omit<User, 'id' | 'createdAt'>): User {
  const user: User = { ...u, id: id(), createdAt: Date.now() }
  data.users.push(user)
  // Все новые пользователи сразу попадают на общий сервер
  ensureLobby(user.id).memberIds.push(user.id)
  save()
  return user
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
    lobby = { id: id(), name: 'Massanger', ownerId, channels: defaultChannels(), memberIds: [], createdAt: Date.now() }
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

export function findChannel(channelId: string) {
  for (const guild of data.guilds) {
    const channel = guild.channels.find((c) => c.id === channelId)
    if (channel) return { guild, channel }
  }
  return undefined
}

// --- messages ---

export function messagesIn(channelId: string, limit = 100): Message[] {
  return data.messages.filter((m) => m.channelId === channelId).slice(-limit)
}

export function addMessage(channelId: string, authorId: string, content: string): Message {
  const message: Message = { id: id(), channelId, authorId, content, createdAt: Date.now() }
  data.messages.push(message)
  save()
  return message
}
