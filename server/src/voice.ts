import type { Server, Socket } from 'socket.io'
import * as store from './store.js'
import { on, reply } from './safe.js'
import { canView, channelPermissions, outranks, type Permission } from './permissions.js'

/**
 * Голос: комнаты, обмен сигналами WebRTC и звонки.
 *
 * Сам звук идёт напрямую между участниками (WebRTC, «каждый с каждым»), сервер только:
 *  - знает, кто в какой комнате сидит, и рассказывает об этом тем, кто комнату видит;
 *  - пересылает служебные сообщения WebRTC (offer/answer/ICE) между участниками одной комнаты;
 *  - «звонит» участникам лички/группы, когда кто-то первым заходит в звонок.
 *
 * Комната = голосовой канал сервера (id канала) или личка/группа (id переписки).
 * Один человек одновременно сидит максимум в одной комнате и только с одной вкладки.
 *
 * В каналах сервера действуют права: зайти — VIEW_CHANNEL + CONNECT, говорить — SPEAK,
 * камера и экран — VIDEO; модераторы могут заглушить (MUTE_MEMBERS) или отключить (MOVE_MEMBERS).
 */

export interface VoiceMemberState {
  userId: string
  muted: boolean
  deafened: boolean
  video: boolean
  screen: boolean
  /** Заглушён на сервере: модератор заглушил или в канале нет права говорить */
  serverMuted: boolean
  /** id MediaStream с камерой / экраном — чтобы собеседники понимали, какое видео что */
  cameraStream: string | null
  screenStream: string | null
  joinedAt: number
}

interface Member extends VoiceMemberState {
  socketId: string
  /** Заглушён модератором (держится, пока человек не выйдет из комнаты) */
  modMuted: boolean
}

type RoomTarget = { kind: 'guild'; guild: store.Guild; channel: store.Channel } | { kind: 'dm'; dm: store.Dm }

const RING_TIMEOUT = 30_000

/** STUN — чтобы найти друг друга через домашние роутеры; TURN (если задан в .env) — для сложных сетей */
function iceServers() {
  const servers: { urls: string[]; username?: string; credential?: string }[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  ]
  const turn = process.env.TURN_URL?.trim()
  if (turn) {
    servers.push({ urls: turn.split(',').map((u) => u.trim()), username: process.env.TURN_USERNAME?.trim(), credential: process.env.TURN_CREDENTIAL?.trim() })
  }
  return servers
}

const formatDuration = (ms: number) => {
  const total = Math.max(1, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h} ч ${m} мин` : m ? `${m} мин ${s} с` : `${s} с`
}

interface Options {
  /** Можно ли звонить в 1:1 личку (те же правила приватности, что и для сообщений) */
  canCall: (fromId: string, dm: store.Dm) => boolean
  /** Служебное сообщение в переписку (пропущенный / завершённый звонок) */
  systemMessage: (dm: store.Dm, text: string) => void
  /** Показать переписку всем её участникам (собеседник мог её ещё не видеть, а ему уже звонят) */
  announceDm: (dm: store.Dm) => void
  /** Счётчики для значков: зашёл в голос, посидел (секунды), начал звонок, включил камеру / экран */
  stats: {
    onVoiceJoin: (userId: string) => void
    onVoiceSession: (userId: string, seconds: number) => void
    onCall: (userId: string) => void
    onMedia: (userId: string, kind: 'video' | 'screen') => void
  }
}

/** disconnected — модератор отключил от голоса */
export type KickReason = 'moved' | 'removed' | 'deleted' | 'left' | 'disconnected'

/**
 * Сигнал WebRTC пересобираем из известных полей: всё остальное (и глубоко вложенный мусор,
 * который может уронить JSON) отбрасываем.
 */
function cleanSignal(data: unknown) {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (d.description !== undefined) {
    const desc = d.description as Record<string, unknown> | null
    if (typeof desc !== 'object' || desc === null) return null
    if ((desc.type !== 'offer' && desc.type !== 'answer') || typeof desc.sdp !== 'string' || desc.sdp.length > 200_000) return null
    return { description: { type: desc.type, sdp: desc.sdp } }
  }
  if (d.candidate !== undefined) {
    const c = d.candidate as Record<string, unknown> | null
    if (typeof c !== 'object' || c === null || typeof c.candidate !== 'string' || c.candidate.length > 2000) return null
    return {
      candidate: {
        candidate: c.candidate,
        sdpMid: typeof c.sdpMid === 'string' ? c.sdpMid.slice(0, 64) : null,
        sdpMLineIndex: Number.isInteger(c.sdpMLineIndex) ? (c.sdpMLineIndex as number) : null,
        usernameFragment: typeof c.usernameFragment === 'string' ? c.usernameFragment.slice(0, 256) : null,
      },
    }
  }
  return null
}

export function createVoice(io: Server, opts: Options) {
  const rooms = new Map<string, Map<string, Member>>()
  const userRoom = new Map<string, string>()
  const rings = new Map<string, { timer: NodeJS.Timeout; waiting: Set<string>; from: string; answered: boolean }>()
  /** Когда в звонке впервые оказалось двое — для «Звонок длился …» */
  const callStarted = new Map<string, number>()

  function target(roomId: string): RoomTarget | undefined {
    const dm = store.findDm(roomId)
    if (dm) return { kind: 'dm', dm }
    for (const guild of store.allGuilds()) {
      const channel = guild.channels.find((c) => c.id === roomId)
      if (channel) return channel.type === 'voice' ? { kind: 'guild', guild, channel } : undefined
    }
    return undefined
  }

  /** Видит ли человек комнату: участник лички/группы — или участник сервера с правом VIEW_CHANNEL */
  const canSee = (t: RoomTarget, userId: string) => (t.kind === 'guild' ? canView(t.guild, t.channel, userId) : t.dm.memberIds.includes(userId))

  /** Кто видит, кто сидит в комнате */
  const audience = (t: RoomTarget) => (t.kind === 'guild' ? t.guild.memberIds.filter((id) => canSee(t, id)) : t.dm.memberIds)

  const publicMembers = (roomId: string): VoiceMemberState[] =>
    [...(rooms.get(roomId)?.values() ?? [])].map(({ socketId: _socket, modMuted: _mod, ...m }) => m)

  function broadcast(roomId: string, t = target(roomId)) {
    const ids = t ? audience(t) : []
    // пустой список не отправляем: io.to([]) разослал бы событие вообще всем
    if (ids.length) io.to(ids.map((id) => `user:${id}`)).emit('voice:room', { roomId, members: publicMembers(roomId) })
  }

  /** Права в комнате: у лички/группы ограничений нет */
  const permsIn = (t: RoomTarget, userId: string): Set<Permission> | null => (t.kind === 'guild' ? channelPermissions(t.guild, t.channel, userId) : null)

  /**
   * Привести состояние участника к его правам: без SPEAK — заглушён сервером,
   * без VIDEO — камера и экран выключены. true — если что-то поменялось.
   */
  function applyPerms(member: Member, perms: Set<Permission> | null) {
    const { serverMuted, video, screen } = member
    member.serverMuted = member.modMuted || (perms !== null && !perms.has('SPEAK'))
    if (perms && !perms.has('VIDEO')) {
      member.video = member.screen = false
      member.cameraStream = member.screenStream = null
    }
    return serverMuted !== member.serverMuted || video !== member.video || screen !== member.screen
  }

  const memberOf = (userId: string) => {
    const roomId = userRoom.get(userId)
    return roomId ? rooms.get(roomId)?.get(userId) : undefined
  }

  // --- звонки в личке / группе ---

  /**
   * Перестать звонить.
   * timeout — 30 секунд никто не взял; abandoned — звонивший положил трубку раньше.
   * В обоих случаях, если так никто и не ответил, в переписке остаётся «Пропущенный звонок».
   */
  function stopRing(roomId: string, why: 'quiet' | 'timeout' | 'abandoned' = 'quiet') {
    const ring = rings.get(roomId)
    if (!ring) return
    clearTimeout(ring.timer)
    rings.delete(roomId)
    for (const id of ring.waiting) io.to(`user:${id}`).emit('call:stop', { roomId })
    if (why === 'quiet' || ring.answered) return
    if (why === 'timeout') io.to(`voice:${roomId}`).emit('call:unanswered', { roomId })
    const t = target(roomId)
    if (t?.kind !== 'dm') return
    opts.systemMessage(t.dm, `📞 Пропущенный звонок от ${store.findUser(ring.from)?.displayName ?? 'кого-то'}`)
    // Тем, кто не ответил, — отдельно: это непрочитанное и повод для уведомления
    for (const id of ring.waiting) io.to(`user:${id}`).emit('call:missed', { roomId, from: ring.from })
  }

  function startRing(roomId: string, dm: store.Dm, from: string) {
    stopRing(roomId)
    const waiting = new Set(dm.memberIds.filter((id) => id !== from))
    if (!waiting.size) return
    opts.announceDm(dm)
    opts.stats.onCall(from)
    for (const id of waiting) io.to(`user:${id}`).emit('call:ring', { roomId, from })
    const timer = setTimeout(() => stopRing(roomId, 'timeout'), RING_TIMEOUT)
    rings.set(roomId, { timer, waiting, from, answered: false })
  }

  /** Человек ответил / отклонил / ушёл — ему больше не звоним */
  function stopRingFor(roomId: string, userId: string, answered: boolean) {
    const ring = rings.get(roomId)
    if (!ring || !ring.waiting.delete(userId)) return
    if (answered) ring.answered = true
    io.to(`user:${userId}`).emit('call:stop', { roomId })
    if (!ring.waiting.size) {
      clearTimeout(ring.timer)
      rings.delete(roomId)
      // Все отказались — звонящему больше некого ждать (гудки выключаются)
      if (!ring.answered) io.to(`voice:${roomId}`).emit('call:unanswered', { roomId, declined: true })
    }
  }

  // --- вход и выход ---

  function leave(userId: string) {
    const roomId = userRoom.get(userId)
    if (!roomId) return
    const room = rooms.get(roomId)
    const member = room?.get(userId)
    room?.delete(userId)
    userRoom.delete(userId)
    if (member) {
      io.sockets.sockets.get(member.socketId)?.leave(`voice:${roomId}`)
      opts.stats.onVoiceSession(userId, Math.round((Date.now() - member.joinedAt) / 1000))
    }

    const t = target(roomId)
    if (!room || room.size === 0) {
      rooms.delete(roomId)
      stopRing(roomId, 'abandoned')
      const started = callStarted.get(roomId)
      callStarted.delete(roomId)
      if (started && t?.kind === 'dm') opts.systemMessage(t.dm, `📞 Звонок завершён · ${formatDuration(Date.now() - started)}`)
    }
    broadcast(roomId, t)
  }

  /** Выкинуть человека из голоса с сообщением в его вкладку */
  function kick(userId: string, reason: KickReason) {
    const member = memberOf(userId)
    if (!member) return
    leave(userId)
    io.to(member.socketId).emit('voice:kicked', { reason })
  }

  function attach(socket: Socket, userId: string) {
    on(socket, 'voice:join', (payload: { roomId?: unknown; muted?: unknown; deafened?: unknown }, ack?: unknown) => {
      const answer = reply(ack)
      const roomId = typeof payload?.roomId === 'string' ? payload.roomId : ''
      const t = roomId ? target(roomId) : undefined
      if (!t) return answer({ error: 'Голосовой канал не найден' })
      const perms = permsIn(t, userId)
      if (perms && (!perms.has('VIEW_CHANNEL') || !perms.has('CONNECT'))) return answer({ error: 'Нет доступа к этому каналу' })
      if (t.kind === 'dm') {
        if (!t.dm.memberIds.includes(userId)) return answer({ error: 'Нет доступа к этому звонку' })
        // Приватность проверяем только у того, кто звонит первым: отвечать на звонок можно всегда
        const answering = rings.get(roomId)?.waiting.has(userId) || (rooms.get(roomId)?.size ?? 0) > 0
        if (t.dm.kind === 'dm' && !answering && !opts.canCall(userId, t.dm)) return answer({ error: 'Собеседник принимает звонки только от друзей' })
      }

      // Уже в голосе — выходим оттуда (если это была другая вкладка — сообщаем ей)
      const previous = memberOf(userId)
      if (previous) {
        leave(userId)
        if (previous.socketId !== socket.id) io.to(previous.socketId).emit('voice:kicked', { reason: 'moved' })
      }

      let room = rooms.get(roomId)
      const wasEmpty = !room || room.size === 0
      if (!room) rooms.set(roomId, (room = new Map()))
      const others = publicMembers(roomId)
      const member: Member = {
        userId,
        socketId: socket.id,
        muted: payload?.muted === true,
        deafened: payload?.deafened === true,
        serverMuted: false,
        modMuted: false,
        video: false,
        screen: false,
        cameraStream: null,
        screenStream: null,
        joinedAt: Date.now(),
      }
      applyPerms(member, perms)
      room.set(userId, member)
      userRoom.set(userId, roomId)
      opts.stats.onVoiceJoin(userId)
      socket.join(`voice:${roomId}`)
      if (room.size >= 2 && !callStarted.has(roomId)) callStarted.set(roomId, Date.now())

      if (t.kind === 'dm') {
        if (wasEmpty) startRing(roomId, t.dm, userId)
        else stopRingFor(roomId, userId, true)
      }
      broadcast(roomId, t)
      answer({ ok: true, members: others, iceServers: iceServers(), ringing: rings.has(roomId) && wasEmpty })
    })

    on(socket, 'voice:leave', () => {
      if (memberOf(userId)?.socketId === socket.id) leave(userId)
    })

    on(socket, 'voice:update', (patch: Record<string, unknown>) => {
      const member = memberOf(userId)
      if (!member || member.socketId !== socket.id || typeof patch !== 'object' || !patch) return
      const roomId = userRoom.get(userId)!
      const t = target(roomId)
      // Без права VIDEO камеру и экран включить нельзя (выключить — можно всегда)
      const perms = t ? permsIn(t, userId) : null
      const noVideo = perms !== null && !perms.has('VIDEO')
      for (const key of ['muted', 'deafened', 'video', 'screen'] as const) {
        const v = patch[key]
        if (typeof v !== 'boolean') continue
        if (noVideo && v && (key === 'video' || key === 'screen')) continue
        if (v && !member[key] && (key === 'video' || key === 'screen')) opts.stats.onMedia(userId, key)
        member[key] = v
      }
      for (const key of ['cameraStream', 'screenStream'] as const) {
        const v = patch[key]
        if (noVideo && v !== null) continue
        if (v === null || (typeof v === 'string' && v.length <= 100)) member[key] = v
      }
      broadcast(roomId, t)
    })

    /** Модерация в голосовом канале сервера: заглушить / снять заглушение / отключить от голоса */
    on(socket, 'voice:moderate', (payload: { userId?: unknown; action?: unknown }, ack?: unknown) => {
      const answer = reply(ack)
      const targetId = typeof payload?.userId === 'string' ? payload.userId : ''
      const action = payload?.action
      if (action !== 'mute' && action !== 'unmute' && action !== 'disconnect') return answer({ error: 'Неизвестное действие' })
      const roomId = userRoom.get(targetId)
      const member = roomId ? rooms.get(roomId)?.get(targetId) : undefined
      const t = roomId ? target(roomId) : undefined
      if (!roomId || !member || !t) return answer({ error: 'Этого человека нет в голосовом канале' })
      if (t.kind !== 'guild') return answer({ error: 'Модерация работает только в голосовых каналах серверов' })

      const need: Permission = action === 'disconnect' ? 'MOVE_MEMBERS' : 'MUTE_MEMBERS'
      const perms = channelPermissions(t.guild, t.channel, userId)
      if (!perms.has('VIEW_CHANNEL') || !perms.has(need)) {
        return answer({ error: need === 'MOVE_MEMBERS' ? 'Нет права отключать участников от голоса' : 'Нет права заглушать участников' })
      }
      if (!outranks(t.guild, userId, targetId)) {
        const why =
          targetId === t.guild.ownerId ? 'Владельца сервера трогать нельзя' : targetId === userId ? 'С собой так нельзя' : 'Его роль не ниже твоей — нельзя'
        return answer({ error: why })
      }

      if (action === 'disconnect') {
        kick(targetId, 'disconnected')
        return answer({ ok: true })
      }
      member.modMuted = action === 'mute'
      if (applyPerms(member, permsIn(t, targetId))) broadcast(roomId, t)
      answer({ ok: true })
    })

    // Пересылка offer/answer/ICE — только между участниками одной комнаты
    on(socket, 'voice:signal', (payload: { to?: unknown; data?: unknown }) => {
      const roomId = userRoom.get(userId)
      const room = roomId ? rooms.get(roomId) : undefined
      if (!room || room.get(userId)?.socketId !== socket.id) return
      const to = typeof payload?.to === 'string' && payload.to !== userId ? room.get(payload.to) : undefined
      const data = cleanSignal(payload?.data)
      if (!to || !data) return
      io.to(to.socketId).emit('voice:signal', { from: userId, data })
    })

    on(socket, 'call:decline', (payload: { roomId?: unknown }) => {
      const roomId = typeof payload?.roomId === 'string' ? payload.roomId : ''
      if (!rings.get(roomId)?.waiting.has(userId)) return
      io.to(`voice:${roomId}`).emit('call:declined', { roomId, userId })
      stopRingFor(roomId, userId, false)
    })

    on(socket, 'disconnect', () => {
      if (memberOf(userId)?.socketId === socket.id) leave(userId)
    })
  }

  return {
    attach,

    /** Кто где сидит — для комнат, которые видит человек (в /api/state) */
    visibleTo(userId: string) {
      const out: Record<string, VoiceMemberState[]> = {}
      for (const roomId of rooms.keys()) {
        const t = target(roomId)
        if (t && canSee(t, userId)) out[roomId] = publicMembers(roomId)
      }
      return out
    },

    /** Кому сейчас звонят — чтобы показать входящий звонок после перезагрузки страницы */
    ringsFor(userId: string) {
      return [...rings.entries()].filter(([, r]) => r.waiting.has(userId)).map(([roomId, r]) => ({ roomId, from: r.from }))
    },

    /** Канал или группа удалены — всех из комнаты выкидываем (того, кто удалил, — без «тебя выкинули») */
    closeRoom(roomId: string, by?: string) {
      stopRing(roomId)
      for (const userId of [...(rooms.get(roomId)?.keys() ?? [])]) kick(userId, userId === by ? 'left' : 'deleted')
    },

    /** Человек ушёл сам (left) или его убрали (removed) с сервера / из группы — выкидываем из этих комнат */
    kickFrom(userId: string, roomIds: string[], reason: 'left' | 'removed') {
      const roomId = userRoom.get(userId)
      if (roomId && roomIds.includes(roomId)) kick(userId, reason)
      for (const id of roomIds) stopRingFor(id, userId, false)
    },

    /** Выкинуть человека из голоса, где бы он ни сидел (бан, отключение модератором) */
    kickUser: (userId: string, reason: KickReason = 'removed') => kick(userId, reason),

    /** В какой комнате сейчас сидит человек (undefined — не в голосе) */
    roomOf: (userId: string) => userRoom.get(userId),

    /** Сколько людей сейчас в голосе (для админки) */
    inVoiceCount: () => userRoom.size,

    /** Состав комнаты поменялся «снаружи» (переименовали группу и т.п.) — разослать заново */
    refresh: (roomId: string) => broadcast(roomId),

    /** Человек только что вступил на сервер — рассказать ему, кто уже сидит в видимых ему голосовых каналах */
    sendRooms(userId: string, roomIds: string[]) {
      for (const roomId of roomIds) {
        const t = target(roomId)
        if (t && canSee(t, userId) && rooms.get(roomId)?.size) io.to(`user:${userId}`).emit('voice:room', { roomId, members: publicMembers(roomId) })
      }
    },

    /**
     * На сервере поменялись роли или права каналов. Кто потерял доступ (VIEW_CHANNEL / CONNECT)
     * к каналу, где сидит, — вылетает; остальным пересчитываем «заглушён сервером» и видео.
     * Видимость комнат рассылаем заново: потерявшим доступ — пустую комнату, получившим — состав.
     */
    recheckGuild(guild: store.Guild) {
      for (const channel of guild.channels) {
        if (channel.type !== 'voice' || !rooms.get(channel.id)?.size) continue
        const t: RoomTarget = { kind: 'guild', guild, channel }
        for (const member of [...rooms.get(channel.id)!.values()]) {
          const perms = channelPermissions(guild, channel, member.userId)
          if (!perms.has('VIEW_CHANNEL') || !perms.has('CONNECT')) kick(member.userId, 'removed')
          else applyPerms(member, perms)
        }
        const members = publicMembers(channel.id)
        for (const id of guild.memberIds) io.to(`user:${id}`).emit('voice:room', { roomId: channel.id, members: canSee(t, id) ? members : [] })
      }
    },
  }
}

export type Voice = ReturnType<typeof createVoice>
