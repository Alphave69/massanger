import { io, type Socket } from 'socket.io-client'
import { api, getToken, SYSTEM_AUTHOR, type DmView, type FriendEntry, type Guild, type Me, type Message, type Presence, type User } from './api'
import { chat, isDmChannel, useChat, type View } from './store'
import { blip, desktopNotify, pulseSphere } from './fx'
import { useSettings } from './settings'
import { ui } from './ui'

const TYPING_TTL = 3500
const IDLE_AFTER = 5 * 60 * 1000 // через 5 минут без движений — «не активен»

let socket: Socket | null = null

const quiet = () => useChat.getState().me?.status === 'dnd'

/** Уведомление: звук + всплывашка + системное (если вкладка свёрнута). В «не беспокоить» — тишина. */
function notify(title: string, text: string, extra: { userId?: string; action?: View } = {}) {
  if (quiet()) return
  void blip()
  if (useSettings.getState().toasts) chat.toast({ title, text, userId: extra.userId, action: extra.action })
  const action = extra.action
  desktopNotify(
    title,
    text,
    action
      ? () => {
          ui.closeSettings()
          chat.setView(action)
        }
      : undefined,
  )
}

const dmWith = (userId: string) => useChat.getState().dms.find((d) => d.userId === userId)?.id

export function connectRealtime(onUnauthorized: () => void) {
  socket?.disconnect()
  // Токен читаем при каждом подключении: после смены пароля он меняется
  let usedToken: string | null = null
  const s = io({
    auth: (cb) => {
      usedToken = getToken()
      cb({ token: usedToken })
    },
  })
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
  s.on('disconnect', (reason) => {
    chat.setConnected(false)
    // Сервер отключил сам (сменили пароль / «выйти везде») — переподключаемся уже с новым токеном
    if (reason === 'io server disconnect') window.setTimeout(() => s.connect(), 800)
  })
  s.on('connect_error', (err) => {
    if (err.message !== 'unauthorized') {
      chat.setConnected(false)
      return
    }
    // Токен в этой вкладке успел обновиться — пробуем ещё раз, а не выкидываем из аккаунта
    const fresh = getToken()
    if (fresh && fresh !== usedToken) {
      window.setTimeout(() => s.connect(), 300)
      return
    }
    onUnauthorized()
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
      if (f.state === 'incoming' && was !== 'incoming') {
        notify(f.user.displayName, 'хочет добавить тебя в друзья', { userId: f.user.id, action: { kind: 'home', tab: 'pending' } })
      }
      if (f.state === 'friends' && was === 'outgoing') {
        // Личка к этому моменту уже создана сервером — по клику сразу в неё
        const dmId = dmWith(f.user.id)
        notify(f.user.displayName, 'принял(а) заявку — переписка уже ждёт', { userId: f.user.id, action: dmId ? { kind: 'dm', dmId } : undefined })
      }
    }
  })

  s.on('message:new', (m: Message) => {
    const { isNew, isActive, mine } = chat.addMessage(m)
    if (!isNew) return
    if (isActive) pulseSphere(mine ? 1 : 0.6)
    const st = useChat.getState()
    if (!mine && !isActive && m.authorId !== SYSTEM_AUTHOR && isDmChannel(st, m.channelId)) {
      const author = st.users[m.authorId]
      notify(author?.displayName ?? 'Новое сообщение', m.content.slice(0, 120), {
        userId: m.authorId,
        action: { kind: 'dm', dmId: m.channelId },
      })
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
