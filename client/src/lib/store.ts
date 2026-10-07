import { create } from 'zustand'
import { SYSTEM_AUTHOR, type DmView, type FriendEntry, type FriendState, type Guild, type InitialState, type Me, type Message, type Presence, type User } from './api'
import { selfPresence } from './status'

export type FriendsTab = 'online' | 'all' | 'pending' | 'add'

export type View = { kind: 'home'; tab: FriendsTab } | { kind: 'dm'; dmId: string } | { kind: 'guild'; guildId: string }

export interface FriendRef {
  userId: string
  state: FriendState
  since: number
}

export interface DmRef {
  id: string
  kind: 'dm' | 'group'
  name: string
  ownerId: string | null
  memberIds: string[]
  /** Собеседник в личке (у группы — null) */
  userId: string | null
  lastMessageAt: number
}

export interface Toast {
  id: number
  title: string
  text?: string
  userId?: string
  action?: View
}

interface ChatState {
  me: Me | null
  users: Record<string, User>
  guilds: Guild[]
  friends: FriendRef[]
  dms: DmRef[]
  presence: Record<string, Presence>
  messages: Record<string, Message[]>
  typing: Record<string, Record<string, number>>
  unread: Record<string, number>
  view: View
  channelByGuild: Record<string, string>
  connected: boolean
  ready: boolean
  toasts: Toast[]
}

const initial: ChatState = {
  me: null,
  users: {},
  guilds: [],
  friends: [],
  dms: [],
  presence: {},
  messages: {},
  typing: {},
  unread: {},
  view: { kind: 'home', tab: 'online' },
  channelByGuild: {},
  connected: true,
  ready: false,
  toasts: [],
}

export const useChat = create<ChatState>(() => initial)

const set = useChat.setState
const get = useChat.getState

function withUsers(users: Record<string, User>, list: (User | null | undefined)[]) {
  const next = { ...users }
  for (const u of list) if (u) next[u.id] = u
  return next
}

const toFriendRef = (f: FriendEntry): FriendRef => ({ userId: f.user.id, state: f.state, since: f.since })
const toDmRef = (d: DmView): DmRef => ({
  id: d.id,
  kind: d.kind,
  name: d.name,
  ownerId: d.ownerId,
  memberIds: d.members.map((m) => m.id),
  userId: d.user?.id ?? null,
  lastMessageAt: d.lastMessageAt,
})

/** Название переписки: имя собеседника, название группы или имена участников */
export function dmTitle(st: ChatState, dm: DmRef): string {
  if (dm.kind === 'dm') return (dm.userId && st.users[dm.userId]?.displayName) || 'Переписка'
  if (dm.name) return dm.name
  const names = dm.memberIds.filter((id) => id !== st.me?.id).map((id) => st.users[id]?.displayName ?? '…')
  return names.length ? names.join(', ') : 'Пустая группа'
}

// ============ селекторы ============

export function activeChannelId(st: ChatState = get()): string | null {
  const v = st.view
  if (v.kind === 'dm') return v.dmId
  if (v.kind === 'guild') {
    const guild = st.guilds.find((g) => g.id === v.guildId)
    if (!guild) return null
    // Открыт может быть и голосовой канал (тогда в середине — «сцена» звонка)
    const remembered = guild.channels.find((c) => c.id === st.channelByGuild[guild.id])
    return (remembered ?? guild.channels.find((c) => c.type === 'text'))?.id ?? null
  }
  return null
}

export function presenceFrom(presence: Record<string, Presence>, me: Me | null, userId: string): Presence {
  if (me && userId === me.id) return selfPresence(me.status)
  return presence[userId] ?? 'offline'
}

export const presenceOf = (st: ChatState, userId: string) => presenceFrom(st.presence, st.me, userId)

export const isDmChannel = (st: ChatState, channelId: string) => st.dms.some((d) => d.id === channelId)

// ============ действия ============

let toastSeq = 0

export const chat = {
  reset() {
    set(initial, true)
  },

  init(s: InitialState) {
    const st = get()
    // Повторная загрузка (после обрыва связи) не должна выкидывать с открытого экрана
    const v = st.view
    const keepView =
      st.ready &&
      (v.kind === 'home' || (v.kind === 'dm' && s.dms.some((d) => d.id === v.dmId)) || (v.kind === 'guild' && s.guilds.some((g) => g.id === v.guildId)))
    set({
      me: s.user,
      users: withUsers(st.users, [
        s.user,
        ...s.guilds.flatMap((g) => g.members),
        ...s.friends.map((f) => f.user),
        ...s.dms.flatMap((d) => d.members),
      ]),
      guilds: s.guilds,
      friends: s.friends.map(toFriendRef),
      dms: s.dms.filter((d) => d.kind === 'group' || d.user).map(toDmRef),
      presence: s.presence,
      view: keepView ? st.view : s.guilds[0] ? { kind: 'guild', guildId: s.guilds[0].id } : { kind: 'home', tab: 'online' },
      ready: true,
    })
  },

  setView(view: View) {
    set({ view })
    chat.markRead()
  },

  openGuildChannel(guildId: string, channelId: string) {
    set((st) => ({ view: { kind: 'guild', guildId }, channelByGuild: { ...st.channelByGuild, [guildId]: channelId } }))
    chat.markRead()
  },

  /** Сбросить непрочитанное у открытого канала */
  markRead() {
    const id = activeChannelId()
    if (id && get().unread[id]) set((st) => ({ unread: { ...st.unread, [id]: 0 } }))
  },

  setConnected(connected: boolean) {
    set({ connected })
  },

  setMe(me: Me) {
    set((st) => ({ me, users: withUsers(st.users, [me]) }))
  },

  upsertUser(user: User) {
    set((st) => ({
      users: withUsers(st.users, [user]),
      me: st.me && st.me.id === user.id ? { ...st.me, ...user } : st.me,
      guilds: st.guilds.map((g) =>
        g.members.some((m) => m.id === user.id) ? { ...g, members: g.members.map((m) => (m.id === user.id ? user : m)) } : g,
      ),
    }))
  },

  setPresence(presence: Record<string, Presence>) {
    set({ presence })
  },

  upsertGuild(guild: Guild) {
    set((st) => ({
      guilds: st.guilds.some((g) => g.id === guild.id) ? st.guilds.map((g) => (g.id === guild.id ? guild : g)) : [...st.guilds, guild],
      users: withUsers(st.users, guild.members),
    }))
  },

  setFriends(list: FriendEntry[]) {
    set((st) => ({ friends: list.map(toFriendRef), users: withUsers(st.users, list.map((f) => f.user)) }))
  },

  upsertDm(dm: DmView) {
    if (dm.kind === 'dm' && !dm.user) return
    set((st) => ({
      dms: [toDmRef(dm), ...st.dms.filter((d) => d.id !== dm.id)],
      users: withUsers(st.users, dm.members),
    }))
  },

  /** Нас убрали из группы (или мы вышли) */
  removeDm(dmId: string) {
    set((st) => ({
      dms: st.dms.filter((d) => d.id !== dmId),
      view: st.view.kind === 'dm' && st.view.dmId === dmId ? { kind: 'home', tab: 'online' } : st.view,
    }))
  },

  /** Сервер удалили или нас с него убрали */
  removeGuild(guildId: string) {
    set((st) => {
      const guilds = st.guilds.filter((g) => g.id !== guildId)
      const viewing = st.view.kind === 'guild' && st.view.guildId === guildId
      return {
        guilds,
        view: viewing ? (guilds[0] ? { kind: 'guild', guildId: guilds[0].id } : { kind: 'home', tab: 'online' }) : st.view,
      }
    })
  },

  clearMessages() {
    set({ messages: {} })
  },

  setMessages(channelId: string, list: Message[]) {
    set((st) => ({ messages: { ...st.messages, [channelId]: st.messages[channelId] ?? list } }))
  },

  /** Добавить сообщение; возвращает, новое ли оно и открыт ли сейчас этот канал */
  addMessage(m: Message) {
    const st = get()
    const list = st.messages[m.channelId]
    if (list?.some((x) => x.id === m.id)) return { isNew: false, isActive: false, mine: false }

    const mine = m.authorId === st.me?.id
    const isActive = activeChannelId(st) === m.channelId && !document.hidden
    const typingHere = st.typing[m.channelId]
    let typing = st.typing
    if (typingHere?.[m.authorId]) {
      const { [m.authorId]: _gone, ...rest } = typingHere
      typing = { ...st.typing, [m.channelId]: rest }
    }

    set({
      messages: list ? { ...st.messages, [m.channelId]: [...list, m] } : st.messages,
      // служебные сообщения («теперь вы друзья») не считаем непрочитанными
      unread: !mine && !isActive && m.authorId !== SYSTEM_AUTHOR ? { ...st.unread, [m.channelId]: (st.unread[m.channelId] ?? 0) + 1 } : st.unread,
      typing,
    })
    return { isNew: true, isActive, mine }
  },

  setTyping(channelId: string, userId: string, until: number) {
    set((st) => ({ typing: { ...st.typing, [channelId]: { ...st.typing[channelId], [userId]: until } } }))
  },

  pruneTyping() {
    const now = Date.now()
    const st = get()
    let changed = false
    const next: ChatState['typing'] = {}
    for (const [ch, users] of Object.entries(st.typing)) {
      next[ch] = {}
      for (const [uid, until] of Object.entries(users)) {
        if (until > now) next[ch][uid] = until
        else changed = true
      }
    }
    if (changed) set({ typing: next })
  },

  toast(t: Omit<Toast, 'id'>) {
    const id = ++toastSeq
    set((st) => ({ toasts: [...st.toasts.slice(-3), { ...t, id }] }))
    window.setTimeout(() => chat.dismissToast(id), 4500)
  },

  dismissToast(id: number) {
    set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
  },
}
