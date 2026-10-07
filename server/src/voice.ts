import type { Server, Socket } from 'socket.io'
import * as store from './store.js'

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
 */

export interface VoiceMemberState {
  userId: string
  muted: boolean
  deafened: boolean
  video: boolean
  screen: boolean
  /** id MediaStream с камерой / экраном — чтобы собеседники понимали, какое видео что */
  cameraStream: string | null
  screenStream: string | null
  joinedAt: number
}

interface Member extends VoiceMemberState {
  socketId: string
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

  /** Кто видит, кто сидит в комнате: весь сервер — для канала, участники — для лички/группы */
  const audience = (t: RoomTarget) => (t.kind === 'guild' ? [`guild:${t.guild.id}`] : t.dm.memberIds.map((id) => `user:${id}`))

  const publicMembers = (roomId: string): VoiceMemberState[] =>
    [...(rooms.get(roomId)?.values() ?? [])].map(({ socketId: _socket, ...m }) => m)

  function broadcast(roomId: string, t = target(roomId)) {
    if (t) io.to(audience(t)).emit('voice:room', { roomId, members: publicMembers(roomId) })
  }

  const memberOf = (userId: string) => {
    const roomId = userRoom.get(userId)
    return roomId ? rooms.get(roomId)?.get(userId) : undefined
  }

  // --- звонки в личке / группе ---

  function stopRing(roomId: string, timedOut = false) {
    const ring = rings.get(roomId)
    if (!ring) return
    clearTimeout(ring.timer)
    rings.delete(roomId)
    for (const id of ring.waiting) io.to(`user:${id}`).emit('call:stop', { roomId })
    if (timedOut) {
      io.to(`voice:${roomId}`).emit('call:unanswered', { roomId })
      const t = target(roomId)
      if (t?.kind === 'dm' && !ring.answered) opts.systemMessage(t.dm, `📞 Пропущенный звонок от ${store.findUser(ring.from)?.displayName ?? 'кого-то'}`)
    }
  }

  function startRing(roomId: string, dm: store.Dm, from: string) {
    stopRing(roomId)
    const waiting = new Set(dm.memberIds.filter((id) => id !== from))
    if (!waiting.size) return
    for (const id of waiting) io.to(`user:${id}`).emit('call:ring', { roomId, from })
    const timer = setTimeout(() => stopRing(roomId, true), RING_TIMEOUT)
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
    if (member) io.sockets.sockets.get(member.socketId)?.leave(`voice:${roomId}`)

    const t = target(roomId)
    if (!room || room.size === 0) {
      rooms.delete(roomId)
      stopRing(roomId)
      const started = callStarted.get(roomId)
      callStarted.delete(roomId)
      if (started && t?.kind === 'dm') opts.systemMessage(t.dm, `📞 Звонок завершён · ${formatDuration(Date.now() - started)}`)
    }
    broadcast(roomId, t)
  }

  /** Выкинуть человека из голоса с сообщением в его вкладку */
  function kick(userId: string, reason: 'moved' | 'removed' | 'deleted') {
    const member = memberOf(userId)
    if (!member) return
    leave(userId)
    io.to(member.socketId).emit('voice:kicked', { reason })
  }

  function attach(socket: Socket, userId: string) {
    socket.on('voice:join', (payload: { roomId?: unknown; muted?: unknown; deafened?: unknown }, ack?: (r: unknown) => void) => {
      const roomId = typeof payload?.roomId === 'string' ? payload.roomId : ''
      const t = roomId ? target(roomId) : undefined
      if (!t) return ack?.({ error: 'Голосовой канал не найден' })
      if (t.kind === 'guild' && !t.guild.memberIds.includes(userId)) return ack?.({ error: 'Нет доступа к этому каналу' })
      if (t.kind === 'dm') {
        if (!t.dm.memberIds.includes(userId)) return ack?.({ error: 'Нет доступа к этому звонку' })
        if (t.dm.kind === 'dm' && !opts.canCall(userId, t.dm)) return ack?.({ error: 'Собеседник принимает звонки только от друзей' })
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
      room.set(userId, {
        userId,
        socketId: socket.id,
        muted: payload?.muted === true,
        deafened: payload?.deafened === true,
        video: false,
        screen: false,
        cameraStream: null,
        screenStream: null,
        joinedAt: Date.now(),
      })
      userRoom.set(userId, roomId)
      socket.join(`voice:${roomId}`)
      if (room.size >= 2 && !callStarted.has(roomId)) callStarted.set(roomId, Date.now())

      if (t.kind === 'dm') {
        if (wasEmpty) startRing(roomId, t.dm, userId)
        else stopRingFor(roomId, userId, true)
      }
      broadcast(roomId, t)
      ack?.({ ok: true, members: others, iceServers: iceServers() })
    })

    socket.on('voice:leave', () => {
      if (memberOf(userId)?.socketId === socket.id) leave(userId)
    })

    socket.on('voice:update', (patch: Record<string, unknown>) => {
      const member = memberOf(userId)
      if (!member || member.socketId !== socket.id || typeof patch !== 'object' || !patch) return
      for (const key of ['muted', 'deafened', 'video', 'screen'] as const) {
        if (typeof patch[key] === 'boolean') member[key] = patch[key]
      }
      for (const key of ['cameraStream', 'screenStream'] as const) {
        const v = patch[key]
        if (v === null || (typeof v === 'string' && v.length <= 100)) member[key] = v
      }
      broadcast(userRoom.get(userId)!)
    })

    // Пересылка offer/answer/ICE — только между участниками одной комнаты
    socket.on('voice:signal', (payload: { to?: unknown; data?: unknown }) => {
      const roomId = userRoom.get(userId)
      const room = roomId ? rooms.get(roomId) : undefined
      if (!room || room.get(userId)?.socketId !== socket.id) return
      const to = typeof payload?.to === 'string' ? room.get(payload.to) : undefined
      const data = payload?.data
      if (!to || typeof data !== 'object' || data === null || JSON.stringify(data).length > 100_000) return
      io.to(to.socketId).emit('voice:signal', { from: userId, data })
    })

    socket.on('call:decline', (payload: { roomId?: unknown }) => {
      const roomId = typeof payload?.roomId === 'string' ? payload.roomId : ''
      if (!rings.get(roomId)?.waiting.has(userId)) return
      stopRingFor(roomId, userId, false)
      io.to(`voice:${roomId}`).emit('call:declined', { roomId, userId })
    })

    socket.on('disconnect', () => {
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
        const visible = t && (t.kind === 'guild' ? t.guild.memberIds.includes(userId) : t.dm.memberIds.includes(userId))
        if (visible) out[roomId] = publicMembers(roomId)
      }
      return out
    },

    /** Кому сейчас звонят — чтобы показать входящий звонок после перезагрузки страницы */
    ringsFor(userId: string) {
      return [...rings.entries()].filter(([, r]) => r.waiting.has(userId)).map(([roomId, r]) => ({ roomId, from: r.from }))
    },

    /** Канал или группа удалены — всех из комнаты выкидываем */
    closeRoom(roomId: string) {
      for (const userId of [...(rooms.get(roomId)?.keys() ?? [])]) kick(userId, 'deleted')
      stopRing(roomId)
    },

    /** Человека убрали с сервера / из группы — если он сидит в одной из этих комнат, выкидываем */
    kickFrom(userId: string, roomIds: string[]) {
      const roomId = userRoom.get(userId)
      if (roomId && roomIds.includes(roomId)) kick(userId, 'removed')
      for (const id of roomIds) stopRingFor(id, userId, false)
    },

    /** Состав комнаты поменялся «снаружи» (переименовали группу и т.п.) — разослать заново */
    refresh: (roomId: string) => broadcast(roomId),
  }
}

export type Voice = ReturnType<typeof createVoice>
