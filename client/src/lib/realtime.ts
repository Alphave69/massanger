import { io, type Socket } from 'socket.io-client'
import { api, getToken, SYSTEM_AUTHOR, type DmView, type FriendEntry, type Guild, type Me, type Message, type Presence, type User } from './api'
import { chat, dmTitle, isDmChannel, useChat, type View } from './store'
import { attachVoice, initVoice } from './voice'
import { blip, desktopNotify, pulseSphere } from './fx'
import { useSettings } from './settings'
import { ui } from './ui'
import { onBadgeEarned } from './badges'
import { onEggFound, onMessageSent } from './eggs'
import { onAnnounce } from './admin'

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
          ui.closeOverlays()
          chat.setView(action)
        }
      : undefined,
  )
}

const dmWith = (userId: string) => useChat.getState().dms.find((d) => d.kind === 'dm' && d.userId === userId)?.id

export function connectRealtime(onUnauthorized: () => void) {
  socket?.disconnect()
  // Токен читаем при каждом подключении: после смены пароля он меняется
  let usedToken: string | null = null
  const s = io({
    auth: (cb) => {
      usedToken = getToken()
      // часовой пояс — чтобы сервер понимал, что у человека ночь (значки «Сова», «Жаворонок»)
      cb({ token: usedToken, tz: new Date().getTimezoneOffset() })
    },
  })
  socket = s
  attachVoice(s)

  let connectedBefore = false
  s.on('connect', () => {
    chat.setConnected(true)
    // После обрыва связи подтягиваем всё, что могли пропустить
    if (connectedBefore) {
      api
        .state()
        .then((state) => {
          chat.init(state)
          initVoice(state.voice, state.rings)
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
  s.on('dm:removed', ({ dmId }: { dmId: string }) => chat.removeDm(dmId))
  s.on('guild:removed', ({ guildId, reason, name, by }: { guildId: string; reason: 'deleted' | 'kicked' | 'left'; name: string; by?: string }) => {
    chat.removeGuild(guildId)
    // Удалил сам — об этом уже сказали настройки сервера
    if (reason === 'deleted' && by !== useChat.getState().me?.id) chat.toast({ title: `«${name}» удалён`, text: 'Владелец удалил сервер' })
    if (reason === 'kicked') chat.toast({ title: `Тебя убрали с «${name}»`, text: 'Владелец сервера исключил тебя' })
  })

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
      const dm = st.dms.find((d) => d.id === m.channelId)
      const title = dm?.kind === 'group' ? `${dmTitle(st, dm)} · ${author?.displayName ?? '…'}` : (author?.displayName ?? 'Новое сообщение')
      notify(title, m.content.slice(0, 120), {
        userId: m.authorId,
        action: { kind: 'dm', dmId: m.channelId },
      })
    }
  })

  s.on('message:deleted', ({ id, channelId }: { id: string; channelId: string }) => chat.removeMessage(channelId, id))
  // реакции и правки приходят целым сообщением
  s.on('message:update', (m: Message) => chat.updateMessage(m))
  s.on('badge:earned', onBadgeEarned)
  s.on('egg:found', onEggFound)
  s.on('announce', onAnnounce)

  s.on('call:missed', ({ roomId, from }: { roomId: string; from: string }) => {
    const st = useChat.getState()
    if (!document.hidden && st.view.kind === 'dm' && st.view.dmId === roomId) return
    chat.bumpUnread(roomId)
    notify(st.users[from]?.displayName ?? 'Звонок', 'пропущенный звонок', { userId: from, action: { kind: 'dm', dmId: roomId } })
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

/**
 * Событие сообщений с ответом сервера (ack): сообщение — если вышло,
 * null — если нет (тост с причиной уже показан).
 */
function messageRequest(event: string, payload: object, failTitle: string, offlineText: string): Promise<Message | null> {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      chat.toast({ title: 'Нет соединения', text: offlineText })
      resolve(null)
      return
    }
    socket.timeout(8000).emit(event, payload, (err: Error | null, res: { error?: string; message?: Message }) => {
      if (err || !res?.message) {
        chat.toast({ title: failTitle, text: res?.error ?? 'Сервер не ответил' })
        resolve(null)
        return
      }
      resolve(res.message)
    })
  })
}

/** Отправить сообщение (replyTo — id сообщения, на которое отвечаем); true — если сервер принял */
export async function sendMessage(channelId: string, content: string, replyTo?: string): Promise<boolean> {
  const message = await messageRequest(
    'message:send',
    { channelId, content, ...(replyTo ? { replyTo } : {}) },
    'Не отправлено',
    'Сообщение не отправлено — переподключаемся…',
  )
  if (!message) return false
  if (chat.addMessage(message).isNew) pulseSphere(1)
  onMessageSent(content)
  return true
}

const hasReaction = (m: Message, emoji: string, userId: string) => Boolean(m.reactions?.[emoji]?.includes(userId))

/** Реакции после нажатия на эмодзи: поставить свою или снять (так же считает сервер) */
export function toggledReaction(m: Message, emoji: string, userId: string): Message {
  const reactions = { ...m.reactions }
  const list = reactions[emoji] ?? []
  if (list.includes(userId)) {
    const rest = list.filter((id) => id !== userId)
    if (rest.length) reactions[emoji] = rest
    else delete reactions[emoji]
  } else {
    reactions[emoji] = [...list, userId]
  }
  const { reactions: _old, ...plain } = m
  return Object.keys(reactions).length ? { ...plain, reactions } : plain
}

/** Поставить / снять реакцию. Сразу рисуем у себя, а если сервер откажет — возвращаем как было */
export async function reactToMessage(message: Message, emoji: string): Promise<boolean> {
  const st = useChat.getState()
  const me = st.me?.id
  if (!me) return false
  // от самой свежей версии сообщения — вдруг его успели изменить
  const current = st.messages[message.channelId]?.find((m) => m.id === message.id) ?? message
  const optimistic = toggledReaction(current, emoji, me)
  chat.updateMessage(optimistic)
  const res = await messageRequest('message:react', { messageId: message.id, emoji }, 'Реакция не поставлена', 'Переподключаемся — попробуй через пару секунд')
  if (res) {
    chat.updateMessage(res)
    return true
  }
  const now = useChat.getState().messages[message.channelId]?.find((m) => m.id === message.id)
  if (now && hasReaction(now, emoji, me) === hasReaction(optimistic, emoji, me)) chat.updateMessage(toggledReaction(now, emoji, me))
  return false
}

/** Изменить текст своего сообщения; true — если сохранилось */
export async function editMessage(messageId: string, content: string): Promise<boolean> {
  const res = await messageRequest('message:edit', { messageId, content }, 'Не сохранилось', 'Правка не сохранена — переподключаемся…')
  if (res) chat.updateMessage(res)
  return Boolean(res)
}

/** Переслать сообщение в другой канал, личку или группу */
export async function forwardMessage(messageId: string, toChannelId: string): Promise<Message | null> {
  const res = await messageRequest('message:forward', { messageId, toChannelId }, 'Не переслано', 'Сообщение не переслано — переподключаемся…')
  if (res) chat.addMessage(res)
  return res
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
