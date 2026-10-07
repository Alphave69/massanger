import { io, type Socket } from 'socket.io-client'
import { api, type DmView, type FriendEntry, type Guild, type Me, type Message, type Presence, type User } from './api'
import { chat, isDmChannel, useChat } from './store'
import { blip, pulseSphere } from './fx'

const TYPING_TTL = 3500
const IDLE_AFTER = 5 * 60 * 1000 // через 5 минут без движений — «не активен»

let socket: Socket | null = null

const quiet = () => useChat.getState().me?.status === 'dnd'

function notify(title: string, text: string, extra: { userId?: string; dmId?: string } = {}) {
  if (quiet()) return
  blip()
  chat.toast({ title, text, userId: extra.userId, action: extra.dmId ? { kind: 'dm', dmId: extra.dmId } : undefined })
}

export function connectRealtime(token: string, onUnauthorized: () => void) {
  socket?.disconnect()
  const s = io({ auth: { token } })
  socket = s

  let connectedBefore = false
  s.on('connect', () => {
    chat.setConnected(true)
    // После обрыва связи подтягиваем всё, что могли пропустить
    if (connectedBefore) {
      api
        .state()
        .then((state) => {
          chat.init(state)
          chat.clearMessages()
        })
        .catch(() => {})
    }
    connectedBefore = true
  })
  s.on('disconnect', () => chat.setConnected(false))
  s.on('connect_error', (err) => {
    if (err.message === 'unauthorized') onUnauthorized()
    else chat.setConnected(false)
  })

  s.on('presence', (p: Record<string, Presence>) => chat.setPresence(p))
  s.on('user:update', (u: User) => chat.upsertUser(u))
  s.on('me:update', (me: Me) => chat.setMe(me))
  s.on('guild:update', (g: Guild) => chat.upsertGuild(g))
  s.on('dm:update', (dm: DmView) => chat.upsertDm(dm))

  s.on('friends:update', (list: FriendEntry[]) => {
    const before = new Map(useChat.getState().friends.map((f) => [f.userId, f.state]))
    chat.setFriends(list)
    for (const f of list) {
      const was = before.get(f.user.id)
      if (f.state === 'incoming' && was !== 'incoming') notify(f.user.displayName, 'хочет добавить тебя в друзья', { userId: f.user.id })
      if (f.state === 'friends' && was === 'outgoing') notify(f.user.displayName, 'принял(а) заявку в друзья', { userId: f.user.id })
    }
  })

  s.on('message:new', (m: Message) => {
    const { isNew, isActive, mine } = chat.addMessage(m)
    if (!isNew) return
    if (isActive) pulseSphere(mine ? 1 : 0.6)
    const st = useChat.getState()
    if (!mine && !isActive && isDmChannel(st, m.channelId)) {
      const author = st.users[m.authorId]
      notify(author?.displayName ?? 'Новое сообщение', m.content.slice(0, 120), { userId: m.authorId, dmId: m.channelId })
    }
  })

  s.on('typing', ({ channelId, userId }: { channelId: string; userId: string }) => {
    if (userId !== useChat.getState().me?.id) chat.setTyping(channelId, userId, Date.now() + TYPING_TTL)
  })

  const stopIdle = trackIdle()
  const typingTimer = window.setInterval(chat.pruneTyping, 1000)

  return () => {
    stopIdle()
    window.clearInterval(typingTimer)
    s.disconnect()
    if (socket === s) socket = null
  }
}

/** Отправить сообщение; true — если сервер принял */
export function sendMessage(channelId: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      chat.toast({ title: 'Нет соединения', text: 'Сообщение не отправлено — переподключаемся…' })
      resolve(false)
      return
    }
    socket.timeout(8000).emit('message:send', { channelId, content }, (err: Error | null, res: { error?: string; message?: Message }) => {
      if (err || !res?.message) {
        chat.toast({ title: 'Не отправлено', text: res?.error ?? 'Сервер не ответил' })
        resolve(false)
        return
      }
      if (chat.addMessage(res.message).isNew) pulseSphere(1)
      resolve(true)
    })
  })
}

let lastTyping = 0
export function sendTyping(channelId: string) {
  const now = Date.now()
  if (now - lastTyping < 2000) return
  lastTyping = now
  socket?.emit('typing', { channelId })
}

/** Автоматический «не активен»: следим за мышью и клавиатурой */
function trackIdle() {
  let last = Date.now()
  let idle = false
  const bump = () => {
    last = Date.now()
    if (idle) {
      idle = false
      socket?.emit('presence:idle', false)
    }
  }
  const events = ['pointermove', 'keydown', 'pointerdown', 'focus'] as const
  for (const e of events) window.addEventListener(e, bump, { passive: true })
  const timer = window.setInterval(() => {
    if (!idle && Date.now() - last > IDLE_AFTER) {
      idle = true
      socket?.emit('presence:idle', true)
    }
  }, 15_000)
  return () => {
    for (const e of events) window.removeEventListener(e, bump)
    window.clearInterval(timer)
  }
}
