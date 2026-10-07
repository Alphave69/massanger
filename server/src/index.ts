import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { Server } from 'socket.io'
import { checkPassword, hashPassword, requireAuth, signToken, userFromToken, type AuthedRequest } from './auth.js'
import * as store from './store.js'

const PORT = Number(process.env.PORT ?? 3001)

const app = express()
app.use(cors())
app.use(express.json())

const http = createServer(app)
const io = new Server(http, { cors: { origin: '*' } })

// --- presence ---

const onlineSockets = new Map<string, number>()
const onlineIds = () => [...onlineSockets.keys()]

function serializeGuild(guild: store.Guild) {
  return {
    id: guild.id,
    name: guild.name,
    ownerId: guild.ownerId,
    channels: guild.channels,
    members: guild.memberIds.map(store.findUser).filter((u) => u !== undefined).map(store.publicUser),
  }
}

// --- REST ---

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/

app.post('/api/auth/register', async (req, res) => {
  const { username, displayName, password } = req.body ?? {}
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    res.status(400).json({ error: 'Логин: 3–32 символа, латиница, цифры, _ и .' })
    return
  }
  if (typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' })
    return
  }
  if (store.findUserByName(username)) {
    res.status(409).json({ error: 'Такой логин уже занят' })
    return
  }
  const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 32) : username
  const user = store.createUser({ username, displayName: name, passwordHash: await hashPassword(password) })
  // Сообщаем всем на общем сервере, что пришёл новый человек
  for (const guild of store.guildsOf(user.id)) io.to(`guild:${guild.id}`).emit('guild:update', serializeGuild(guild))
  res.json({ token: signToken(user), user: store.publicUser(user) })
})

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  const user = typeof username === 'string' ? store.findUserByName(username) : undefined
  if (!user || typeof password !== 'string' || !(await checkPassword(password, user.passwordHash))) {
    res.status(401).json({ error: 'Неверный логин или пароль' })
    return
  }
  res.json({ token: signToken(user), user: store.publicUser(user) })
})

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: store.publicUser((req as AuthedRequest).user) })
})

app.get('/api/guilds', requireAuth, (req, res) => {
  res.json({ guilds: store.guildsOf((req as AuthedRequest).user.id).map(serializeGuild), online: onlineIds() })
})

app.post('/api/guilds', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : ''
  if (!name) {
    res.status(400).json({ error: 'Укажи название сервера' })
    return
  }
  const guild = store.createGuild(name, user.id)
  io.in(`user:${user.id}`).socketsJoin(`guild:${guild.id}`)
  res.json({ guild: serializeGuild(guild) })
})

app.post('/api/guilds/:id/join', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const guild = store.joinGuild(String(req.params.id), user.id)
  if (!guild) {
    res.status(404).json({ error: 'Сервер не найден — проверь код приглашения' })
    return
  }
  io.in(`user:${user.id}`).socketsJoin(`guild:${guild.id}`)
  io.to(`guild:${guild.id}`).emit('guild:update', serializeGuild(guild))
  res.json({ guild: serializeGuild(guild) })
})

app.get('/api/channels/:id/messages', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const found = store.findChannel(String(req.params.id))
  if (!found || !found.guild.memberIds.includes(user.id)) {
    res.status(404).json({ error: 'Канал не найден' })
    return
  }
  res.json({ messages: store.messagesIn(found.channel.id) })
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

// --- realtime ---

io.use((socket, next) => {
  const user = userFromToken(socket.handshake.auth?.token)
  if (!user) return next(new Error('unauthorized'))
  socket.data.userId = user.id
  next()
})

io.on('connection', (socket) => {
  const userId: string = socket.data.userId
  socket.join(`user:${userId}`)
  for (const guild of store.guildsOf(userId)) socket.join(`guild:${guild.id}`)

  onlineSockets.set(userId, (onlineSockets.get(userId) ?? 0) + 1)
  io.emit('presence', onlineIds())

  socket.on('message:send', (payload: { channelId?: unknown; content?: unknown }, ack?: (r: unknown) => void) => {
    const content = typeof payload?.content === 'string' ? payload.content.trim().slice(0, 4000) : ''
    const found = typeof payload?.channelId === 'string' ? store.findChannel(payload.channelId) : undefined
    if (!content || !found || found.channel.type !== 'text' || !found.guild.memberIds.includes(userId)) {
      ack?.({ error: 'Не удалось отправить сообщение' })
      return
    }
    const message = store.addMessage(found.channel.id, userId, content)
    io.to(`guild:${found.guild.id}`).emit('message:new', message)
    ack?.({ message })
  })

  socket.on('typing', (payload: { channelId?: unknown }) => {
    const found = typeof payload?.channelId === 'string' ? store.findChannel(payload.channelId) : undefined
    if (!found || !found.guild.memberIds.includes(userId)) return
    socket.to(`guild:${found.guild.id}`).emit('typing', { channelId: found.channel.id, userId })
  })

  socket.on('disconnect', () => {
    const left = (onlineSockets.get(userId) ?? 1) - 1
    if (left <= 0) onlineSockets.delete(userId)
    else onlineSockets.set(userId, left)
    io.emit('presence', onlineIds())
  })
})

http.listen(PORT, () => {
  const url = existsSync(clientDist) ? `http://localhost:${PORT}` : 'http://localhost:5173'
  console.log(`Massanger запущен → открой ${url}`)
})
