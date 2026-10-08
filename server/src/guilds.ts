import type { Express, Request, Response } from 'express'
import type { Server } from 'socket.io'
import { requireAuth, type AuthedRequest } from './auth.js'
import * as store from './store.js'
import type { Voice } from './voice.js'
import { canKick, canView, hasGuildPermission, noPermission, type Permission } from './permissions.js'
import { serializeGuild } from './guildView.js'

/**
 * Управление сервером: название, каналы, участники, удаление.
 * Что кому можно — решают права ролей (permissions.ts); удалить сервер может только владелец.
 */

export type Fail = (res: Response, code: number, error: string) => void

interface Deps {
  io: Server
  voice: Voice
  fail: Fail
  /** Разослать сервер всем участникам — каждому свою версию (см. guildView.ts) */
  emitGuild: (guild: store.Guild) => void
}

const MAX_CHANNELS = 50

/** Текстовые каналы — как в Discord: строчные буквы, пробелы → дефисы */
export const textChannelName = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 32)

const voiceChannelName = (raw: string) => raw.trim().replace(/\s+/g, ' ').slice(0, 32)

const channelName = (type: store.Channel['type'], raw: unknown) => (typeof raw === 'string' ? (type === 'text' ? textChannelName(raw) : voiceChannelName(raw)) : '')

export const voiceIds = (guild: store.Guild) => guild.channels.filter((c) => c.type === 'voice').map((c) => c.id)

/**
 * Сервер из :id, где человек состоит. need — нужное право на сервере ('owner' — только владелец).
 * Если чего-то не хватает — отвечаем ошибкой и возвращаем undefined.
 */
export function guildFor(req: Request, res: Response, fail: Fail, need?: Permission | 'owner') {
  const { user } = req as AuthedRequest
  const guild = store.findGuild(String(req.params.id))
  if (!guild || !guild.memberIds.includes(user.id)) return void fail(res, 404, 'Сервер не найден')
  if (need === 'owner' && guild.ownerId !== user.id) return void fail(res, 403, 'Это может только владелец сервера')
  if (need && need !== 'owner' && !hasGuildPermission(guild, user.id, need)) return void fail(res, 403, noPermission(need))
  return guild
}

/** Канал из :channelId, который человек видит (скрытые от него каналы — как будто их нет) */
export function channelFor(guild: store.Guild, req: Request, res: Response, fail: Fail) {
  const { user } = req as AuthedRequest
  const channel = guild.channels.find((c) => c.id === String(req.params.channelId))
  if (!channel || !canView(guild, channel, user.id)) return void fail(res, 404, 'Канал не найден')
  return channel
}

/** Удалить сервер целиком: всех из голоса, сообщения, и сказать участникам (by — кто удалил) */
export function destroyGuild(io: Server, voice: Voice, guild: store.Guild, by?: string) {
  for (const id of voiceIds(guild)) voice.closeRoom(id, by)
  store.deleteGuild(guild)
  io.to(`guild:${guild.id}`).emit('guild:removed', { guildId: guild.id, reason: 'deleted', name: guild.name, by })
  io.in(`guild:${guild.id}`).socketsLeave(`guild:${guild.id}`)
}

export function registerGuildRoutes(app: Express, { io, voice, fail, emitGuild }: Deps) {
  /** Убрать человека с сервера: из голоса, из комнаты сокетов, из списка — и сообщить ему */
  function dropMember(guild: store.Guild, userId: string, reason: 'left' | 'kicked') {
    voice.kickFrom(userId, voiceIds(guild), reason === 'left' ? 'left' : 'removed')
    store.removeGuildMember(guild, userId)
    io.in(`user:${userId}`).socketsLeave(`guild:${guild.id}`)
    io.to(`user:${userId}`).emit('guild:removed', { guildId: guild.id, reason, name: guild.name })
    emitGuild(guild)
  }

  const userOf = (req: Request) => (req as AuthedRequest).user

  app.patch('/api/guilds/:id', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_SERVER')
    if (!guild) return
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : ''
    if (!name) return fail(res, 400, 'Укажи название сервера')
    guild.name = name
    store.persist()
    emitGuild(guild)
    res.json({ guild: serializeGuild(guild, userOf(req).id) })
  })

  app.delete('/api/guilds/:id', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'owner')
    if (!guild) return
    if (guild.isLobby) return fail(res, 400, 'Общий сервер удалить нельзя — сюда попадают все новые люди')
    destroyGuild(io, voice, guild, userOf(req).id)
    res.json({ ok: true })
  })

  app.post('/api/guilds/:id/leave', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail)
    if (!guild) return
    const user = userOf(req)
    if (guild.ownerId === user.id) return fail(res, 400, 'Владелец не может выйти со своего сервера — его можно только удалить')
    dropMember(guild, user.id, 'left')
    res.json({ ok: true })
  })

  app.delete('/api/guilds/:id/members/:userId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'KICK_MEMBERS')
    if (!guild) return
    const user = userOf(req)
    const targetId = String(req.params.userId)
    if (!guild.memberIds.includes(targetId)) return fail(res, 404, 'Такого участника нет')
    if (targetId === user.id) return fail(res, 400, 'Себя выгнать нельзя — можно только выйти с сервера')
    if (targetId === guild.ownerId) return fail(res, 403, 'Владельца сервера выгнать нельзя')
    if (!canKick(guild, user.id, targetId)) return fail(res, 403, 'Его роль не ниже твоей — выгнать нельзя')
    dropMember(guild, targetId, 'kicked')
    res.json({ guild: serializeGuild(guild, user.id) })
  })

  app.post('/api/guilds/:id/channels', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_CHANNELS')
    if (!guild) return
    const type = req.body?.type === 'voice' ? 'voice' : req.body?.type === 'text' ? 'text' : null
    if (!type) return fail(res, 400, 'Выбери тип канала')
    const name = channelName(type, req.body?.name)
    if (!name) return fail(res, 400, 'Укажи название канала')
    if (guild.channels.length >= MAX_CHANNELS) return fail(res, 400, `На сервере уже ${MAX_CHANNELS} каналов — это максимум`)
    const channel = store.addChannel(guild, name, type)
    emitGuild(guild)
    const view = serializeGuild(guild, userOf(req).id)
    res.json({ guild: view, channel: view.channels.find((c) => c.id === channel.id) ?? channel })
  })

  app.patch('/api/guilds/:id/channels/:channelId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_CHANNELS')
    if (!guild) return
    const channel = channelFor(guild, req, res, fail)
    if (!channel) return
    const user = userOf(req)
    if (req.body?.name !== undefined) {
      const name = channelName(channel.type, req.body.name)
      if (!name) return fail(res, 400, 'Укажи название канала')
      channel.name = name
    }
    // Сдвиг вверх/вниз среди видимых каналов того же типа
    const move = req.body?.move
    if (move === -1 || move === 1) {
      const same = guild.channels.filter((c) => c.type === channel.type && canView(guild, c, user.id))
      const neighbour = same[same.indexOf(channel) + move]
      if (neighbour) {
        const i = guild.channels.indexOf(channel)
        const j = guild.channels.indexOf(neighbour)
        ;[guild.channels[i], guild.channels[j]] = [guild.channels[j], guild.channels[i]]
      }
    }
    store.persist()
    emitGuild(guild)
    res.json({ guild: serializeGuild(guild, user.id) })
  })

  app.delete('/api/guilds/:id/channels/:channelId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_CHANNELS')
    if (!guild) return
    const channel = channelFor(guild, req, res, fail)
    if (!channel) return
    if (channel.type === 'text' && guild.channels.filter((c) => c.type === 'text').length <= 1) {
      return fail(res, 400, 'На сервере должен остаться хотя бы один текстовый канал')
    }
    const user = userOf(req)
    if (channel.type === 'voice') voice.closeRoom(channel.id, user.id)
    store.removeChannel(guild, channel.id)
    emitGuild(guild)
    res.json({ guild: serializeGuild(guild, user.id) })
  })
}
