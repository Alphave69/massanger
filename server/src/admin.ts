import type { Express, NextFunction, Request, Response } from 'express'
import type { Server } from 'socket.io'
import { requireAuth, type AuthedRequest } from './auth.js'
import type { Badges } from './badges.js'
import { destroyGuild } from './guilds.js'
import * as store from './store.js'
import type { Voice } from './voice.js'

/**
 * Админка приложения: люди (галочки, админы, блокировки, привилегии, значки), серверы, объявления.
 * Владелец приложения — админ навсегда; назначать админов может только он.
 */

interface Deps {
  io: Server
  voice: Voice
  badges: Badges
  fail: (res: Response, code: number, error: string) => void
  /** Разослать обновлённый профиль: ему — целиком, остальным — публичную часть */
  changed: (user: store.User) => void
  kickStaleSockets: (user: store.User) => Promise<void>
  isOnline: (userId: string) => boolean
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!store.isAdmin((req as AuthedRequest).user)) {
    res.status(403).json({ error: 'Это только для админов Nuntius' })
    return
  }
  next()
}

export function registerAdminRoutes(app: Express, { io, voice, badges, fail, changed, kickStaleSockets, isOnline }: Deps) {
  const view = (u: store.User) => ({
    ...store.publicUser(u),
    email: u.email,
    status: u.status,
    online: isOnline(u.id),
    admin: store.isAdmin(u),
    owner: store.isAppOwner(u),
    banned: u.banned,
    privileges: u.privileges,
    stats: u.stats,
    eggsFound: Object.keys(u.eggs).length,
  })

  const target = (req: Request, res: Response) => {
    const user = store.findUser(String(req.params.id))
    if (!user) return void fail(res, 404, 'Такого человека нет')
    return user
  }

  app.get('/api/admin/overview', requireAuth, requireAdmin, (_req, res) => {
    const users = store.allUsers()
    const c = store.counts()
    res.json({
      stats: { ...c, online: users.filter((u) => isOnline(u.id)).length, inVoice: voice.inVoiceCount() },
      users: users.map(view),
      guilds: store.allGuilds().map((g) => ({ id: g.id, name: g.name, ownerId: g.ownerId, members: g.memberIds.length, isLobby: Boolean(g.isLobby) })),
    })
  })

  app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const actor = (req as AuthedRequest).user
    const user = target(req, res)
    if (!user) return
    const body = req.body ?? {}
    const actorOwner = store.isAppOwner(actor)
    const patch: store.UserPatch = {}

    if (body.verified !== undefined) {
      if (typeof body.verified !== 'boolean') return fail(res, 400, 'Неверное значение галочки')
      patch.verified = body.verified
    }
    if (body.admin !== undefined) {
      if (typeof body.admin !== 'boolean') return fail(res, 400, 'Неверное значение')
      if (!actorOwner) return fail(res, 403, 'Назначать админов может только владелец Nuntius')
      if (store.isAppOwner(user)) return fail(res, 400, 'Владелец — админ навсегда')
      patch.admin = body.admin
    }
    if (body.banned !== undefined) {
      if (typeof body.banned !== 'boolean') return fail(res, 400, 'Неверное значение')
      if (user.id === actor.id) return fail(res, 400, 'Себя заблокировать нельзя')
      if (store.isAppOwner(user)) return fail(res, 400, 'Владельца заблокировать нельзя')
      if (store.isAdmin(user) && !actorOwner) return fail(res, 403, 'Админа может заблокировать только владелец')
      patch.banned = body.banned
      if (body.banned) patch.tokenVersion = user.tokenVersion + 1
    }
    if (body.privileges !== undefined) {
      if (typeof body.privileges !== 'object' || body.privileges === null) return fail(res, 400, 'Неверные привилегии')
      const next = { ...user.privileges }
      for (const key of ['createServers', 'createGroups'] as const) {
        const v = body.privileges[key]
        if (v === undefined) continue
        if (typeof v !== 'boolean') return fail(res, 400, 'Неверные привилегии')
        next[key] = v
      }
      patch.privileges = next
    }

    store.updateUser(user, patch)
    if (patch.banned) {
      // Блокировка: выкидываем из голоса и со всех устройств
      voice.kickUser(user.id, 'removed')
      await kickStaleSockets(user)
    }
    changed(user)
    res.json({ user: view(user) })
  })

  app.post('/api/admin/users/:id/badges', requireAuth, requireAdmin, (req, res) => {
    const user = target(req, res)
    if (!user) return
    const id = typeof req.body?.badgeId === 'string' ? req.body.badgeId : ''
    if (!badges.grant(user, id)) return fail(res, 400, 'Такого значка нет')
    res.json({ user: view(user) })
  })

  app.delete('/api/admin/users/:id/badges/:badgeId', requireAuth, requireAdmin, (req, res) => {
    const user = target(req, res)
    if (!user) return
    badges.revoke(user, String(req.params.badgeId))
    res.json({ user: view(user) })
  })

  app.post('/api/admin/announce', requireAuth, requireAdmin, (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (!text) return fail(res, 400, 'Напиши текст объявления')
    if (text.length > 300) return fail(res, 400, 'Объявление — до 300 символов')
    io.emit('announce', { text, from: (req as AuthedRequest).user.id })
    res.json({ ok: true })
  })

  app.delete('/api/admin/guilds/:id', requireAuth, requireAdmin, (req, res) => {
    const guild = store.findGuild(String(req.params.id))
    if (!guild) return fail(res, 404, 'Сервер не найден')
    if (guild.isLobby) return fail(res, 400, 'Общий сервер удалить нельзя')
    destroyGuild(io, voice, guild)
    res.json({ ok: true })
  })
}
