import './env.js' // первым делом: секреты из server/.env нужны остальным модулям при загрузке
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express, { type Response } from 'express'
import { Server, type Socket } from 'socket.io'
import { checkPassword, hashPassword, requireAuth, signToken, userFromToken, type AuthedRequest } from './auth.js'
import * as store from './store.js'
import { checkCode, cooldownLeft, dropCode, issueCode, pendingData, RESEND_AFTER } from './codes.js'
import { explainMailError, mailConfigured, sendCode, verifyMail, type CodePurpose } from './mail.js'
import { createVoice } from './voice.js'
import { on } from './safe.js'
import { createBadges, eggsOf, EGGS } from './badges.js'
import { createMessages } from './messages.js'
import { registerAdminRoutes } from './admin.js'
import { registerGuildRoutes } from './guilds.js'
import { registerGroupRoutes } from './groups.js'
import { registerRoleRoutes } from './roles.js'
import { broadcastGuild, serializeGuild } from './guildView.js'
import { hasChannelPermission } from './permissions.js'

const PORT = Number(process.env.PORT ?? 3001)

const app = express()
app.use(cors())
app.use(express.json())

const http = createServer(app)
const io = new Server(http, { cors: { origin: '*' } })

const fail = (res: Response, code: number, error: string) => void res.status(code).json({ error })

// ============ представления данных для клиента ============

/** Себя пользователь видит вместе с выбранным статусом (в т.ч. «невидимка») и настройками приватности */
const selfUser = (u: store.User) => ({
  ...store.publicUser(u),
  status: u.status,
  privacy: u.privacy,
  email: u.email,
  stats: u.stats,
  eggs: eggsOf(u),
  eggTotal: EGGS.length,
  admin: store.isAdmin(u),
  owner: store.isAppOwner(u),
  privileges: u.privileges,
})

/** Профиль поменялся (значки, галочка…) — ему целиком, остальным — публичную часть */
function userChanged(u: store.User) {
  io.emit('user:update', store.publicUser(u))
  io.to(`user:${u.id}`).emit('me:update', selfUser(u))
}

const badges = createBadges(io, userChanged)

/** Разослать сервер всем участникам — каждому свою версию: каналы и права у всех разные (guildView.ts) */
const emitGuild = (guild: store.Guild) => broadcastGuild(io, guild)

/** Событие нескольким людям сразу. Пустой список не шлём: io.to([]) разослал бы событие вообще всем */
function emitTo(userIds: string[], event: string, payload: unknown, except?: Socket) {
  if (!userIds.length) return
  const rooms = userIds.map((id) => `user:${id}`)
  ;(except ? except.to(rooms) : io.to(rooms)).emit(event, payload)
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
  const members = dm.memberIds.map(store.findUser).filter((u) => u !== undefined).map(store.publicUser)
  return {
    id: dm.id,
    kind: dm.kind,
    name: dm.name,
    ownerId: dm.ownerId,
    members,
    // у лички — собеседник (для группы null)
    user: dm.kind === 'dm' ? (members.find((m) => m.id !== userId) ?? null) : null,
    lastMessageAt: dm.lastMessageAt,
  }
}

/** Служебное сообщение в личку/группу («создал группу», «пропущенный звонок» …) */
function systemMessage(dm: store.Dm, text: string) {
  const message = store.addMessage(dm.id, store.SYSTEM_AUTHOR, text)
  for (const id of dm.memberIds) {
    io.to(`user:${id}`).emit('message:new', message)
    io.to(`user:${id}`).emit('dm:update', dmView(dm, id))
  }
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
  badges.syncId(a)
  badges.syncId(b)
}

/** Может ли `fromId` писать в личку человеку `to` с учётом его настроек приватности */
const canWriteDm = (fromId: string, to: store.User, dmId?: string) =>
  store.areFriends(fromId, to.id) ||
  (to.privacy.dms === 'servers' && store.shareGuild(fromId, to.id)) ||
  // сам начал переписку — значит, ответить ему можно
  (dmId !== undefined && store.hasWritten(dmId, to.id))

/** Собеседник в 1:1 личке */
const otherIn = (dm: store.Dm, userId: string) => store.findUser(dm.memberIds.find((id) => id !== userId) ?? '')

const messages = createMessages({ io, badges, dmView, canWriteDm, emitTo })

const voice = createVoice(io, {
  canCall: (fromId, dm) => {
    const other = otherIn(dm, fromId)
    return Boolean(other && canWriteDm(fromId, other, dm.id))
  },
  systemMessage,
  announceDm: (dm) => {
    for (const id of dm.memberIds) io.to(`user:${id}`).emit('dm:update', dmView(dm, id))
  },
  stats: badges,
})

/** bcrypt учитывает только первые 72 байта (русская буква — 2 байта): длиннее не пускаем, чтобы пароль не обрезался молча */
const tooLong = (password: string) => Buffer.byteLength(password, 'utf8') > 72

/** После смены пароля / «выйти везде» отключаем сокеты, вошедшие со старым токеном */
async function kickStaleSockets(user: store.User) {
  const sockets = await io.in(`user:${user.id}`).fetchSockets()
  for (const s of sockets) if (s.data.tokenVersion !== user.tokenVersion) s.disconnect(true)
}

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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const normEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')
const validEmail = (email: string) => email.length <= 254 && EMAIL_RE.test(email)
const BAD_EMAIL = 'Проверь почту — похоже, в адресе опечатка'

/** Проверка нового пароля; возвращает текст ошибки или null */
function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 6) return 'Пароль должен быть не короче 6 символов'
  if (tooLong(password)) return 'Пароль слишком длинный — сократи его (русская буква занимает вдвое больше места)'
  return null
}

/**
 * Отправить письмо с кодом. code === null — прошлый код ещё свежий, письмо не шлём.
 * Если почта не ушла — забываем код и отвечаем понятной ошибкой (false).
 */
async function mailCode(res: Response, key: string, email: string, code: string | null, purpose: CodePurpose) {
  if (code === null) return true
  try {
    await sendCode(email, code, purpose)
    return true
  } catch (err) {
    dropCode(key)
    const why = explainMailError(err)
    console.error(`  ✖ Письмо на ${email} не ушло: ${why}`)
    fail(res, 502, `Не получилось отправить письмо: ${why}`)
    return false
  }
}

interface PendingRegistration {
  email: string
  username: string
  displayName: string
  passwordHash: string
}

/** Регистрация, шаг 1: проверяем данные и шлём код на почту */
app.post('/api/auth/register', async (req, res) => {
  const { username, displayName, password } = req.body ?? {}
  const email = normEmail(req.body?.email)
  if (!validEmail(email)) return fail(res, 400, BAD_EMAIL)
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) return fail(res, 400, 'Логин: 3–32 символа, латиница, цифры, _ и .')
  const problem = passwordProblem(password)
  if (problem) return fail(res, 400, problem)
  if (store.findUserByEmail(email)) return fail(res, 409, 'Эта почта уже привязана к аккаунту — попробуй войти')
  if (store.findUserByName(username)) return fail(res, 409, 'Такой логин уже занят')

  const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 32) : username
  const key = `register:${email}`
  const data: PendingRegistration = { email, username, displayName: name, passwordHash: await hashPassword(password) }
  const { code, resendIn } = issueCode(key, data)
  if (!(await mailCode(res, key, email, code, 'register'))) return
  res.json({ email, resendIn })
})

/** Регистрация, шаг 2: код из письма верный — создаём аккаунт */
app.post('/api/auth/register/verify', (req, res) => {
  const email = normEmail(req.body?.email)
  const check = checkCode<PendingRegistration>(`register:${email}`, req.body?.code)
  if (!check.ok) return fail(res, 400, check.error)
  const d = check.data
  if (store.findUserByEmail(d.email)) return fail(res, 409, 'Эта почта уже привязана к аккаунту — попробуй войти')
  if (store.findUserByName(d.username)) return fail(res, 409, 'Пока ты вводил код, этот логин заняли — начни заново с другим')

  const user = store.createUser(d)
  // Сообщаем всем на общем сервере, что пришёл новый человек
  for (const guild of store.guildsOf(user.id)) emitGuild(guild)
  res.json({ token: signToken(user), user: selfUser(user) })
})

/** Вход по логину или по почте */
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  const id = typeof username === 'string' ? username.trim() : ''
  const user = id.includes('@') ? store.findUserByEmail(id) : store.findUserByName(id)
  if (!user || typeof password !== 'string' || !(await checkPassword(password, user.passwordHash))) {
    return fail(res, 401, 'Неверный логин, почта или пароль')
  }
  if (user.banned) return fail(res, 403, 'Аккаунт заблокирован')
  res.json({ token: signToken(user), user: selfUser(user) })
})

/** Забыл пароль, шаг 1: код на почту. Есть ли такой аккаунт — не сообщаем */
app.post('/api/auth/reset', async (req, res) => {
  const email = normEmail(req.body?.email)
  if (!validEmail(email)) return fail(res, 400, BAD_EMAIL)
  const user = store.findUserByEmail(email)
  if (!user) return res.json({ email, resendIn: RESEND_AFTER / 1000 })
  const key = `reset:${email}`
  const { code, resendIn } = issueCode(key, { userId: user.id })
  if (!(await mailCode(res, key, email, code, 'reset'))) return
  res.json({ email, resendIn })
})

/** Забыл пароль, шаг 2: код + новый пароль → входим, остальные сеансы выкидываем */
app.post('/api/auth/reset/verify', async (req, res) => {
  const email = normEmail(req.body?.email)
  const problem = passwordProblem(req.body?.password)
  if (problem) return fail(res, 400, problem)
  const check = checkCode<{ userId: string }>(`reset:${email}`, req.body?.code)
  if (!check.ok) return fail(res, 400, check.error)
  const user = store.findUser(check.data.userId)
  if (!user) return fail(res, 404, 'Аккаунт не найден')
  if (user.banned) return fail(res, 403, 'Аккаунт заблокирован')
  store.updateUser(user, { passwordHash: await hashPassword(req.body.password), tokenVersion: user.tokenVersion + 1 })
  void kickStaleSockets(user)
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
    guilds: store.guildsOf(user.id).map((g) => serializeGuild(g, user.id)),
    friends: friendEntries(user.id),
    dms: dmsFor(user.id),
    presence: presenceMap(),
    voice: voice.visibleTo(user.id),
    rings: voice.ringsFor(user.id),
  })
})

app.patch('/api/me', requireAuth, async (req, res) => {
  const { user } = req as AuthedRequest
  const { displayName, customStatus, status, username, bio, privacy } = req.body ?? {}
  const patch: store.UserPatch = {}

  if (username !== undefined) {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) return fail(res, 400, 'Логин: 3–32 символа, латиница, цифры, _ и .')
    const taken = store.findUserByName(username)
    if (taken && taken.id !== user.id) return fail(res, 409, 'Такой логин уже занят')
    // Логин — то, чем входят: менять только с паролем, иначе чужой оставленный сеанс может «увести» аккаунт
    const password = req.body?.password
    if (username !== user.username && (typeof password !== 'string' || !(await checkPassword(password, user.passwordHash)))) {
      return fail(res, 403, 'Чтобы сменить логин, введи верный текущий пароль')
    }
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
  userChanged(user)
  badges.sync(user) // «Стиляга», «Палиндром»
  if (patch.status) broadcastPresence()
  res.json({ user: selfUser(user) })
})

app.post('/api/me/password', requireAuth, async (req, res) => {
  const { user } = req as AuthedRequest
  const { current, next } = req.body ?? {}
  if (typeof current !== 'string' || !(await checkPassword(current, user.passwordHash))) return fail(res, 403, 'Текущий пароль введён неверно')
  if (typeof next !== 'string' || next.length < 6) return fail(res, 400, 'Новый пароль должен быть не короче 6 символов')
  if (tooLong(next)) return fail(res, 400, 'Пароль слишком длинный — сократи его (русская буква занимает вдвое больше места)')
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

/** Привязать / сменить почту, шаг 1: пароль + новый адрес → код на этот адрес */
app.post('/api/me/email', requireAuth, async (req, res) => {
  const { user } = req as AuthedRequest
  const email = normEmail(req.body?.email)
  if (!validEmail(email)) return fail(res, 400, BAD_EMAIL)
  if (email === user.email) return fail(res, 400, 'Эта почта уже привязана к тебе')
  const owner = store.findUserByEmail(email)
  if (owner && owner.id !== user.id) return fail(res, 409, 'Эта почта уже привязана к другому аккаунту')
  const password = req.body?.password
  if (typeof password !== 'string' || !(await checkPassword(password, user.passwordHash))) return fail(res, 403, 'Неверный текущий пароль')

  const key = `bind:${user.id}`
  const wait = cooldownLeft(key)
  if (wait && pendingData<{ email: string }>(key)?.email !== email) {
    return fail(res, 429, `Подожди ${wait} с — потом можно отправить код на другой адрес`)
  }
  const { code, resendIn } = issueCode(key, { email })
  if (!(await mailCode(res, key, email, code, 'bind'))) return
  res.json({ email, resendIn })
})

/** Привязать почту, шаг 2: код из письма */
app.post('/api/me/email/verify', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const check = checkCode<{ email: string }>(`bind:${user.id}`, req.body?.code)
  if (!check.ok) return fail(res, 400, check.error)
  const owner = store.findUserByEmail(check.data.email)
  if (owner && owner.id !== user.id) return fail(res, 409, 'Эту почту только что привязали к другому аккаунту')
  store.updateUser(user, { email: check.data.email })
  io.to(`user:${user.id}`).emit('me:update', selfUser(user))
  res.json({ user: selfUser(user) })
})

// --- серверы ---

app.post('/api/guilds', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : ''
  if (!name) return fail(res, 400, 'Укажи название сервера')
  if (!user.privileges.createServers) return fail(res, 403, 'Создавать серверы тебе запретил администратор')
  const guild = store.createGuild(name, user.id)
  io.in(`user:${user.id}`).socketsJoin(`guild:${guild.id}`)
  badges.award(user, 'architect')
  res.json({ guild: serializeGuild(guild, user.id) })
})

app.post('/api/guilds/:id/join', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const guild = store.joinGuild(String(req.params.id), user.id)
  if (!guild) return fail(res, 404, 'Сервер не найден — проверь код приглашения')
  io.in(`user:${user.id}`).socketsJoin(`guild:${guild.id}`)
  emitGuild(guild)
  voice.sendRooms(
    user.id,
    guild.channels.filter((c) => c.type === 'voice').map((c) => c.id),
  )
  res.json({ guild: serializeGuild(guild, user.id) })
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
  // серверный канал без права VIEW_CHANNEL — как будто его нет
  if (!store.channelAccess(channelId, user.id)) return fail(res, 404, 'Канал не найден')
  res.json({ messages: store.messagesIn(channelId) })
})

/** Удалить сообщение: своё — всегда, чужое — с правом MANAGE_MESSAGES в канале, админ приложения — любое */
app.delete('/api/messages/:id', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const message = store.findMessage(String(req.params.id))
  const access = message ? store.locateChannel(message.channelId) : undefined
  const admin = store.isAdmin(user)
  if (!message || !access || (!admin && !store.canSee(access, user.id))) return fail(res, 404, 'Сообщение не найдено')
  const own = message.authorId === user.id
  const moderator = access.kind === 'guild' && hasChannelPermission(access.guild, access.channel, user.id, 'MANAGE_MESSAGES')
  if (!own && !moderator && !admin) {
    return fail(res, 403, message.authorId === store.SYSTEM_AUTHOR ? 'Служебные сообщения удаляют только модераторы' : 'Нет права удалять чужие сообщения')
  }
  store.deleteMessage(message)
  emitTo(store.viewersOf(access), 'message:deleted', { id: message.id, channelId: message.channelId })
  res.json({ ok: true })
})

registerGuildRoutes(app, { io, voice, fail, emitGuild })
registerRoleRoutes(app, { voice, fail, emitGuild })
registerGroupRoutes(app, { io, voice, fail, dmView, systemMessage, badges })
registerAdminRoutes(app, { io, voice, badges, fail, changed: userChanged, kickStaleSockets, isOnline: (id) => (socketCount.get(id) ?? 0) > 0 })

// --- значки и пасхалки ---

app.get('/api/badges', requireAuth, (req, res) => {
  res.json(badges.catalogFor((req as AuthedRequest).user))
})

app.post('/api/me/eggs', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest
  const found = badges.findEgg(user, typeof req.body?.id === 'string' ? req.body.id : '')
  if (!found) return fail(res, 400, 'Такой пасхалки нет')
  res.json({ isNew: found.isNew, egg: found.egg, user: selfUser(user) })
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
  voice.attach(socket, userId)

  // Часовой пояс (для «Совы» и «Жаворонка») и значки за стаж — при каждом подключении
  const me = store.findUser(userId)
  const tz = socket.handshake.auth?.tz
  if (me && typeof tz === 'number' && Number.isInteger(tz) && Math.abs(tz) <= 840 && tz !== me.tz) store.updateUser(me, { tz })
  if (me) badges.sync(me)

  // отправка, ответы, реакции, правка и пересылка — messages.ts
  messages.attach(socket, userId)

  on(socket, 'typing', (payload: { channelId?: unknown }) => {
    const channelId = typeof payload?.channelId === 'string' ? payload.channelId : ''
    const access = channelId ? store.channelAccess(channelId, userId) : undefined
    if (!access || messages.writeProblem(access, userId)) return
    emitTo(store.viewersOf(access), 'typing', { channelId, userId }, socket)
  })

  // Клиент сам сообщает, что человек отошёл (нет активности несколько минут)
  on(socket, 'presence:idle', (idle: unknown) => {
    const was = autoIdle.has(userId)
    if (idle === true) autoIdle.add(userId)
    else autoIdle.delete(userId)
    if (was !== autoIdle.has(userId)) broadcastPresence()
  })

  on(socket, 'disconnect', () => {
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
  void verifyMail().then(({ ok, text }) => console.log(`  ${ok ? '✓' : mailConfigured ? '✖' : '✉'}  Почта: ${text}`))
})
