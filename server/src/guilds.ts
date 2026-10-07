import type { Express, Request, Response } from 'express'
import type { Server } from 'socket.io'
import { requireAuth, type AuthedRequest } from './auth.js'
import * as store from './store.js'
import type { Voice } from './voice.js'

/** Управление сервером: название, каналы, участники, удаление. Почти всё — только владельцу. */

interface Deps {
  io: Server
  voice: Voice
  fail: (res: Response, code: number, error: string) => void
  serializeGuild: (guild: store.Guild) => unknown
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

const voiceIds = (guild: store.Guild) => guild.channels.filter((c) => c.type === 'voice').map((c) => c.id)

export function registerGuildRoutes(app: Express, { io, voice, fail, serializeGuild }: Deps) {
  const emitGuild = (guild: store.Guild) => io.to(`guild:${guild.id}`).emit('guild:update', serializeGuild(guild))

  /** Сервер, где человек состоит; ownerOnly — и где он владелец. Иначе — ответ с ошибкой и undefined */
  function guildFor(req: Request, res: Response, ownerOnly: boolean) {
    const { user } = req as AuthedRequest
    const guild = store.findGuild(String(req.params.id))
    if (!guild || !guild.memberIds.includes(user.id)) return void fail(res, 404, 'Сервер не найден')
    if (ownerOnly && guild.ownerId !== user.id) return void fail(res, 403, 'Это может только владелец сервера')
    return guild
  }

  /** Убрать человека с сервера: из голоса, из комнаты сокетов, из списка — и сообщить ему */
  function dropMember(guild: store.Guild, userId: string, reason: 'left' | 'kicked') {
    voice.kickFrom(userId, voiceIds(guild))
    store.removeGuildMember(guild, userId)
    io.in(`user:${userId}`).socketsLeave(`guild:${guild.id}`)
    io.to(`user:${userId}`).emit('guild:removed', { guildId: guild.id, reason, name: guild.name })
    emitGuild(guild)
  }

  app.patch('/api/guilds/:id', requireAuth, (req, res) => {
    const guild = guildFor(req, res, true)
    if (!guild) return
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : ''
    if (!name) return fail(res, 400, 'Укажи название сервера')
    guild.name = name
    store.persist()
    emitGuild(guild)
    res.json({ guild: serializeGuild(guild) })
  })

  app.delete('/api/guilds/:id', requireAuth, (req, res) => {
    const guild = guildFor(req, res, true)
    if (!guild) return
    if (guild.isLobby) return fail(res, 400, 'Общий сервер удалить нельзя — сюда попадают все новые люди')
    for (const id of voiceIds(guild)) voice.closeRoom(id)
    store.deleteGuild(guild)
    io.to(`guild:${guild.id}`).emit('guild:removed', { guildId: guild.id, reason: 'deleted', name: guild.name })
    io.in(`guild:${guild.id}`).socketsLeave(`guild:${guild.id}`)
    res.json({ ok: true })
  })

  app.post('/api/guilds/:id/leave', requireAuth, (req, res) => {
    const guild = guildFor(req, res, false)
    if (!guild) return
    const { user } = req as AuthedRequest
    if (guild.ownerId === user.id) return fail(res, 400, 'Владелец не может выйти со своего сервера — его можно только удалить')
    dropMember(guild, user.id, 'left')
    res.json({ ok: true })
  })

  app.delete('/api/guilds/:id/members/:userId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, true)
    if (!guild) return
    const targetId = String(req.params.userId)
    if (targetId === guild.ownerId) return fail(res, 400, 'Себя выгнать нельзя')
    if (!guild.memberIds.includes(targetId)) return fail(res, 404, 'Такого участника нет')
    dropMember(guild, targetId, 'kicked')
    res.json({ guild: serializeGuild(guild) })
  })

  app.post('/api/guilds/:id/channels', requireAuth, (req, res) => {
    const guild = guildFor(req, res, true)
    if (!guild) return
    const type = req.body?.type === 'voice' ? 'voice' : req.body?.type === 'text' ? 'text' : null
    if (!type) return fail(res, 400, 'Выбери тип канала')
    const name = channelName(type, req.body?.name)
    if (!name) return fail(res, 400, 'Укажи название канала')
    if (guild.channels.length >= MAX_CHANNELS) return fail(res, 400, `На сервере уже ${MAX_CHANNELS} каналов — это максимум`)
    const channel = store.addChannel(guild, name, type)
    emitGuild(guild)
    res.json({ guild: serializeGuild(guild), channel })
  })

  app.patch('/api/guilds/:id/channels/:channelId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, true)
    if (!guild) return
    const channel = guild.channels.find((c) => c.id === String(req.params.channelId))
    if (!channel) return fail(res, 404, 'Канал не найден')
    if (req.body?.name !== undefined) {
      const name = channelName(channel.type, req.body.name)
      if (!name) return fail(res, 400, 'Укажи название канала')
      channel.name = name
    }
    // Сдвиг вверх/вниз среди каналов того же типа
    const move = req.body?.move
    if (move === -1 || move === 1) {
      const same = guild.channels.filter((c) => c.type === channel.type)
      const neighbour = same[same.indexOf(channel) + move]
      if (neighbour) {
        const i = guild.channels.indexOf(channel)
        const j = guild.channels.indexOf(neighbour)
        ;[guild.channels[i], guild.channels[j]] = [guild.channels[j], guild.channels[i]]
      }
    }
    store.persist()
    emitGuild(guild)
    res.json({ guild: serializeGuild(guild) })
  })

  app.delete('/api/guilds/:id/channels/:channelId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, true)
    if (!guild) return
    const channel = guild.channels.find((c) => c.id === String(req.params.channelId))
    if (!channel) return fail(res, 404, 'Канал не найден')
    if (channel.type === 'text' && guild.channels.filter((c) => c.type === 'text').length <= 1) {
      return fail(res, 400, 'На сервере должен остаться хотя бы один текстовый канал')
    }
    if (channel.type === 'voice') voice.closeRoom(channel.id)
    store.removeChannel(guild, channel.id)
    emitGuild(guild)
    res.json({ guild: serializeGuild(guild) })
  })
}
