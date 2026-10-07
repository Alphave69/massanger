import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express, { type Response } from 'express'
import { Server } from 'socket.io'
import { checkPassword, hashPassword, requireAuth, signToken, userFromToken, type AuthedRequest } from './auth.js'
import * as store from './store.js'

const PORT = Number(process.env.PORT ?? 3001)

const app = express()
app.use(cors())
app.use(express.json())

const http = createServer(app)
const io = new Server(http, { cors: { origin: '*' } })

const fail = (res: Response, code: number, error: string) => void res.status(code).json({ error })

// ============ представления данных для клиента ============

/** Себя пользователь видит вместе с выбранным статусом (в т.ч. «невидимка») и настройками приватности */
const selfUser = (u: store.User) => ({ ...store.publicUser(u), status: u.status, privacy: u.privacy })

function serializeGuild(guild: store.Guild) {
  return {
    id: guild.id,
    name: guild.name,
    ownerId: guild.ownerId,
    channels: guild.channels,
    members: guild.memberIds.map(store.findUser).filter((u) => u !== undefined).map(store.publicUser),
  }
}

function friendEntries(userId: string) {
  return store.relationsOf(userId).flatMap((r) => {
    const other = store.findUser(r.from === userId ? r.to : r.from)
    if (!other) return []
    const state = r.state === 'friends' ? 'friends' : r.from === userId ? 'outgoing' : 'incoming'
    return [{ user: store.publicUser(other), state, since: r.createdAt }]
  })
}

function dmView(dm: store.Dm, userId: string) {
  const other = store.findUser(dm.memberIds.find((id) => id !== userId) ?? userId)
  return { id: dm.id, user: other ? store.publicUser(other) : null, lastMessageAt: dm.lastMessageAt }
}

const dmsFor = (userId: string) => store.dmsOf(userId).map((dm) => dmView(dm, userId))

const emitFriends = (...userIds: string[]) => {
  for (const id of userIds) io.to(`user:${id}`).emit('friends:update', friendEntries(id))
}

/**
 * Дружба состоялась: сразу заводим личку у обоих и пишем в неё служебное сообщение,
 * чтобы переписка появилась в списке без лишних кликов.
 * Вызывать ДО emitFriends — тогда уведомление «принял заявку» уже знает, какую личку открыть.
 */
function befriend(a: string, b: string) {
  const dm = store.openDm(a, b)
  const message = store.addMessage(dm.id, store.SYSTEM_AUTHOR, 'Теперь вы друзья — скажите друг другу привет ✦')
  for (const id of dm.memberIds) {
    io.to(`user:${id}`).emit('dm:update', dmView(dm, id))
    io.to(`user:${id}`).emit('message:new', message)
  }
}

/** Может ли `fromId` писать в личку человеку `to` с учётом его настроек приватности */
const canWriteDm = (fromId: string, to: store.User) =>
  store.areFriends(fromId, to.id) || (to.privacy.dms === 'servers' && store.shareGuild(fromId, to.id))

/** После смены пароля / «выйти везде» отключаем сокеты, вошедшие со старым токеном */
async function kickStaleSockets(user: store.User) {
  const sockets = await io.in(`user:${user.id}`).fetchSockets()
  for (const s of sockets) if (s.data.tokenVersion !== user.tokenVersion) s.disconnect(true)
}

/** Комнаты, куда уходят события канала: серверный канал — всем участникам сервера, личка — двоим */
const roomsFor = (access: store.ChannelAccess) =>
  access.kind === 'guild' ? [`guild:${access.guild.id}`] : access.dm.memberIds.map((id) => `user:${id}`)

// ============ присутствие и статусы ============

const socketCount = new Map<string, number>()
const autoIdle = new Set<string>() // кто давно не трогал мышь/клавиатуру

function presenceMap() {
  const out: Record<string, store.Status> = {}
  for (const userId of socketCount.keys()) {
    const u = store.findUser(userId)
    if (!u || u.status === 'invisible') continue // невидимку остальные видят «не в сети»
    out[userId] = u.status === 'online' && autoIdle.has(userId) ? 'idle' : u.status
  }
  return out
}

const broadcastPresence = () => io.emit('presence', presenceMap())

// ============ REST ============

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/

app.post('/api/auth/register', async (req, res) => {
  const { username, displayName, password } = req.body ?? {}
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return fail(res, 400, 'Логин: 3–32 символа, латиница, цифры, _ и .')
  if (typeof password !== 'string' || password.length < 6) return fail(res, 400, 'Пароль должен быть не короче 6 символов')
  if (password.length > 72) return fail(res, 400, 'Пароль слишком длинный — максимум 72 символа')
  if (store.findUserByName(username)) return fail(res, 409, 'Такой логин уже занят')

  const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 32) : username
  const user = store.createUser({ username, displayName: name, passwordHash: await hashPassword(password) })
  // Сообщаем всем на общем сервере, что пришёл новый человек
  for (const guild of store.guildsOf(user.id)) io.to(`guild:${guild.id}`).emit('guild:update', serializeGuild(guild))
  res.json({ token: signToken(user), user: selfUser(user) })
})

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  const user = typeof username === 'string' ? store.findUserByName(username) : undefined
  if (!user || typeof password !== 'string' || !(await checkPassword(password, user.passwordHash))) {
    return fail(res, 401, 'Неверный логин или пароль')
  }
  res.json({ token: signToken(user), user: selfUser(user) })
})

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: selfUser((req as AuthedRequest).user) })
})

/** Всё, что нужно клиенту при старте, одним запросом */
app.get('/api/state', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  res.json({
    user: selfUser(user),
    guilds: store.guildsOf(user.id).map(serializeGuild),
    friends: friendEntries(user.id),
    dms: dmsFor(user.id),
    presence: presenceMap(),
  })
})

app.patch('/api/me', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const { displayName, customStatus, status, username, bio, privacy } = req.body ?? {}
  const patch: store.UserPatch = {}

  if (username !== undefined) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return fail(res, 400, 'Логин: 3–32 символа, латиница, цифры, _ и .')
    const taken = store.findUserByName(username)
    if (taken && taken.id !== user.id) return fail(res, 409, 'Такой логин уже занят')
    patch.username = username
  }
  if (bio !== undefined) {
    if (typeof bio !== 'string') return fail(res, 400, 'Неверный текст «О себе»')
    patch.bio = bio.trim().slice(0, 190)
  }
  if (privacy !== undefined) {
    if (typeof privacy !== 'object' || privacy === null) return fail(res, 400, 'Неверные настройки приватности')
    const next = { ...user.privacy }
    if (privacy.dms !== undefined) {
      if (privacy.dms !== 'servers' && privacy.dms !== 'friends') return fail(res, 400, 'Неверная настройка личных сообщений')
      next.dms = privacy.dms
    }
    if (privacy.friendRequests !== undefined) {
      if (privacy.friendRequests !== 'everyone' && privacy.friendRequests !== 'nobody') return fail(res, 400, 'Неверная настройка заявок')
      next.friendRequests = privacy.friendRequests
    }
    patch.privacy = next
  }

  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || !displayName.trim()) return fail(res, 400, 'Имя не может быть пустым')
    patch.displayName = displayName.trim().slice(0, 32)
  }
  if (customStatus !== undefined) {
    if (typeof customStatus !== 'string') return fail(res, 400, 'Неверный статус')
    patch.customStatus = customStatus.trim().slice(0, 64)
  }
  if (status !== undefined) {
    if (!store.STATUSES.includes(status)) return fail(res, 400, 'Неизвестный статус')
    patch.status = status
  }

  store.updateUser(user, patch)
  io.emit('user:update', store.publicUser(user))
  io.to(`user:${user.id}`).emit('me:update', selfUser(user))
  if (patch.status) broadcastPresence()
  res.json({ user: selfUser(user) })
})

app.post('/api/me/password', requireAuth, async (req, res) => {
  const { user } = req as AuthedRequest
  const { current, next } = req.body ?? {}
  if (typeof current !== 'string' || !(await checkPassword(current, user.passwordHash))) return fail(res, 403, 'Текущий пароль введён неверно')
  if (typeof next !== 'string' || next.length < 6) return fail(res, 400, 'Новый пароль должен быть не короче 6 символов')
  if (next.length > 72) return fail(res, 400, 'Пароль слишком длинный — максимум 72 символа')
  if (next === current) return fail(res, 400, 'Новый пароль совпадает со старым')
  store.updateUser(user, { passwordHash: await hashPassword(next), tokenVersion: user.tokenVersion + 1 })
  void kickStaleSockets(user)
  res.json({ token: signToken(user) })
})

/** Выйти на всех устройствах, кроме текущего (ему выдаём новый токен) */
app.post('/api/me/logout-all', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  store.updateUser(user, { tokenVersion: user.tokenVersion + 1 })
  void kickStaleSockets(user)
  res.json({ token: signToken(user) })
})

// --- серверы ---

app.post('/api/guilds', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : ''
  if (!name) return fail(res, 400, 'Укажи название сервера')
  const guild = store.createGuild(name, user.id)
  io.in(`user:${user.id}`).socketsJoin(`guild:${guild.id}`)
  res.json({ guild: serializeGuild(guild) })
})

app.post('/api/guilds/:id/join', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const guild = store.joinGuild(String(req.params.id), user.id)
  if (!guild) return fail(res, 404, 'Сервер не найден — проверь код приглашения')
  io.in(`user:${user.id}`).socketsJoin(`guild:${guild.id}`)
  io.to(`guild:${guild.id}`).emit('guild:update', serializeGuild(guild))
  res.json({ guild: serializeGuild(guild) })
})

// --- друзья ---

app.post('/api/friends', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const username = typeof req.body?.username === 'string' ? req.body.username.trim().replace(/^@/, '') : ''
  const target = username ? store.findUserByName(username) : undefined
  if (!target) return fail(res, 404, `Пользователь «${username}» не найден — проверь логин`)
  if (target.id === user.id) return fail(res, 400, 'Себя добавить не получится 🙂')

  const existing = store.relationBetween(user.id, target.id)
  if (existing?.state === 'friends') return fail(res, 409, `Вы с ${target.displayName} уже друзья`)
  if (existing?.from === user.id) return fail(res, 409, 'Заявка уже отправлена — ждём ответа')
  if (!existing && target.privacy.friendRequests === 'nobody') return fail(res, 403, `${target.displayName} не принимает заявки в друзья`)

  // Если он уже звал нас в друзья — просто принимаем
  if (existing) {
    store.acceptRelation(existing)
    befriend(user.id, target.id)
  } else {
    store.addRelation(user.id, target.id)
  }

  emitFriends(user.id, target.id)
  res.json({ friends: friendEntries(user.id), accepted: Boolean(existing) })
})

app.post('/api/friends/:userId/accept', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const otherId = String(req.params.userId)
  const relation = store.relationBetween(user.id, otherId)
  if (!relation || relation.state !== 'pending' || relation.to !== user.id) return fail(res, 404, 'Заявка не найдена')
  store.acceptRelation(relation)
  befriend(user.id, otherId)
  emitFriends(user.id, otherId)
  res.json({ friends: friendEntries(user.id) })
})

/** Отклонить / отменить заявку или удалить из друзей */
app.delete('/api/friends/:userId', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const otherId = String(req.params.userId)
  const relation = store.relationBetween(user.id, otherId)
  if (relation) {
    store.removeRelation(relation)
    emitFriends(user.id, otherId)
  }
  res.json({ friends: friendEntries(user.id) })
})

// --- личные сообщения ---

app.post('/api/dms', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const target = typeof req.body?.userId === 'string' ? store.findUser(req.body.userId) : undefined
  if (!target || target.id === user.id) return fail(res, 404, 'Пользователь не найден')
  if (!canWriteDm(user.id, target)) {
    return fail(
      res,
      403,
      target.privacy.dms === 'friends' ? `${target.displayName} принимает сообщения только от друзей` : 'Писать можно друзьям и людям с общих серверов',
    )
  }
  const dm = store.openDm(user.id, target.id)
  io.to(`user:${user.id}`).emit('dm:update', dmView(dm, user.id))
  res.json({ dm: dmView(dm, user.id) })
})

app.get('/api/channels/:id/messages', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const channelId = String(req.params.id)
  if (!store.channelAccess(channelId, user.id)) return fail(res, 404, 'Канал не найден')
  res.json({ messages: store.messagesIn(channelId) })
})

// В продакшене отдаём собранный клиент с того же порта
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist')
if (existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(resolve(clientDist, 'index.html')))
} else {
  // В режиме разработки интерфейс отдаёт Vite — перекидываем туда
  app.get('/', (_req, res) => res.redirect('http://localhost:5173'))
}

// ============ realtime ============

io.use((socket, next) => {
  const user = userFromToken(socket.handshake.auth?.token)
  if (!user) return next(new Error('unauthorized'))
  socket.data.userId = user.id
  socket.data.tokenVersion = user.tokenVersion
  next()
})

io.on('connection', (socket) => {
  const userId: string = socket.data.userId
  socket.join(`user:${userId}`)
  for (const guild of store.guildsOf(userId)) socket.join(`guild:${guild.id}`)

  socketCount.set(userId, (socketCount.get(userId) ?? 0) + 1)
  broadcastPresence()

  socket.on('message:send', (payload: { channelId?: unknown; content?: unknown }, ack?: (r: unknown) => void) => {
    const channelId = typeof payload?.channelId === 'string' ? payload.channelId : ''
    const content = typeof payload?.content === 'string' ? payload.content.trim().slice(0, 4000) : ''
    const access = channelId ? store.channelAccess(channelId, userId) : undefined
    if (!content || !access || (access.kind === 'guild' && access.channel.type !== 'text')) {
      ack?.({ error: 'Не удалось отправить сообщение' })
      return
    }
    if (access.kind === 'dm') {
      const other = store.findUser(access.dm.memberIds.find((id) => id !== userId) ?? '')
      if (!other || !canWriteDm(userId, other)) {
        ack?.({ error: 'Собеседник принимает сообщения только от друзей' })
        return
      }
    }
    const message = store.addMessage(channelId, userId, content)
    io.to(roomsFor(access)).emit('message:new', message)
    if (access.kind === 'dm') {
      for (const id of access.dm.memberIds) io.to(`user:${id}`).emit('dm:update', dmView(access.dm, id))
    }
    ack?.({ message })
  })

  socket.on('typing', (payload: { channelId?: unknown }) => {
    const channelId = typeof payload?.channelId === 'string' ? payload.channelId : ''
    const access = channelId ? store.channelAccess(channelId, userId) : undefined
    if (access) socket.to(roomsFor(access)).emit('typing', { channelId, userId })
  })

  // Клиент сам сообщает, что человек отошёл (нет активности несколько минут)
  socket.on('presence:idle', (idle: unknown) => {
    const was = autoIdle.has(userId)
    if (idle === true) autoIdle.add(userId)
    else autoIdle.delete(userId)
    if (was !== autoIdle.has(userId)) broadcastPresence()
  })

  socket.on('disconnect', () => {
    const left = (socketCount.get(userId) ?? 1) - 1
    if (left <= 0) {
      socketCount.delete(userId)
      autoIdle.delete(userId)
    } else {
      socketCount.set(userId, left)
    }
    broadcastPresence()
  })
})

http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✖ Порт ${PORT} уже занят — похоже, Nuntius уже запущен в другом окне.`)
    console.error('    Закрой все чёрные окна (cmd, Git Bash) и запусти start.bat снова.\n')
  } else {
    console.error(err)
  }
  process.exit(1)
})

http.listen(PORT, () => {
  const url = existsSync(clientDist) ? `http://localhost:${PORT}` : 'http://localhost:5173'
  console.log(`Nuntius запущен → открой ${url}`)
})
