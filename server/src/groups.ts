import type { Express, Request, Response } from 'express'
import type { Server } from 'socket.io'
import { requireAuth, type AuthedRequest } from './auth.js'
import * as store from './store.js'
import type { Voice } from './voice.js'

/** Групповые переписки: создать, переименовать, добавить людей, исключить, выйти */

interface Deps {
  io: Server
  voice: Voice
  fail: (res: Response, code: number, error: string) => void
  dmView: (dm: store.Dm, userId: string) => unknown
  systemMessage: (dm: store.Dm, text: string) => void
}

const nameOf = (userId: string) => store.findUser(userId)?.displayName ?? 'кто-то'

/** Список id из тела запроса: строки, без повторов и без себя */
const idsFrom = (raw: unknown, selfId: string) =>
  Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === 'string' && v !== selfId))] : []

export function registerGroupRoutes(app: Express, { io, voice, fail, dmView, systemMessage }: Deps) {
  const emitDm = (dm: store.Dm) => {
    for (const id of dm.memberIds) io.to(`user:${id}`).emit('dm:update', dmView(dm, id))
  }

  function groupFor(req: Request, res: Response) {
    const { user } = req as AuthedRequest
    const dm = store.findDm(String(req.params.id))
    if (!dm || dm.kind !== 'group' || !dm.memberIds.includes(user.id)) return void fail(res, 404, 'Группа не найдена')
    return dm
  }

  /** В группу добавляют только друзей (как в Discord) */
  function notFriendsProblem(userId: string, ids: string[]) {
    for (const id of ids) {
      if (!store.findUser(id)) return 'Пользователь не найден'
      if (!store.areFriends(userId, id)) return `${nameOf(id)} не у тебя в друзьях — в группу можно добавлять только друзей`
    }
    return null
  }

  app.post('/api/groups', requireAuth, (req, res) => {
    const { user } = req as AuthedRequest
    const ids = idsFrom(req.body?.userIds, user.id)
    if (!ids.length) return fail(res, 400, 'Выбери хотя бы одного друга')
    if (ids.length + 1 > store.GROUP_LIMIT) return fail(res, 400, `В группе может быть максимум ${store.GROUP_LIMIT} человек`)
    const problem = notFriendsProblem(user.id, ids)
    if (problem) return fail(res, 400, problem)

    // Один человек — это обычная личка
    if (ids.length === 1) {
      const dm = store.openDm(user.id, ids[0])
      io.to(`user:${user.id}`).emit('dm:update', dmView(dm, user.id))
      return res.json({ dm: dmView(dm, user.id) })
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : ''
    const group = store.createGroup(user.id, ids, name)
    emitDm(group)
    systemMessage(group, `${nameOf(user.id)} создал(а) группу`)
    res.json({ dm: dmView(group, user.id) })
  })

  app.patch('/api/groups/:id', requireAuth, (req, res) => {
    const group = groupFor(req, res)
    if (!group) return
    const { user } = req as AuthedRequest
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 48) : ''
    if (name === group.name) return res.json({ dm: dmView(group, user.id) })
    group.name = name
    store.persist()
    emitDm(group)
    systemMessage(group, name ? `${nameOf(user.id)} переименовал(а) группу в «${name}»` : `${nameOf(user.id)} убрал(а) название группы`)
    res.json({ dm: dmView(group, user.id) })
  })

  app.post('/api/groups/:id/members', requireAuth, (req, res) => {
    const group = groupFor(req, res)
    if (!group) return
    const { user } = req as AuthedRequest
    const ids = idsFrom(req.body?.userIds, user.id).filter((id) => !group.memberIds.includes(id))
    if (!ids.length) return fail(res, 400, 'Выбери, кого добавить')
    if (group.memberIds.length + ids.length > store.GROUP_LIMIT) return fail(res, 400, `В группе может быть максимум ${store.GROUP_LIMIT} человек`)
    const problem = notFriendsProblem(user.id, ids)
    if (problem) return fail(res, 400, problem)
    group.memberIds.push(...ids)
    store.persist()
    emitDm(group)
    voice.refresh(group.id)
    systemMessage(group, `${nameOf(user.id)} добавил(а) в группу: ${ids.map(nameOf).join(', ')}`)
    res.json({ dm: dmView(group, user.id) })
  })

  /** Убрать человека из группы (исключить или выйти самому) */
  function remove(group: store.Dm, userId: string, text: string, reason: 'left' | 'removed') {
    group.memberIds = group.memberIds.filter((id) => id !== userId)
    voice.kickFrom(userId, [group.id], reason)
    io.to(`user:${userId}`).emit('dm:removed', { dmId: group.id })
    if (!group.memberIds.length) {
      voice.closeRoom(group.id)
      store.deleteDm(group)
      return
    }
    if (group.ownerId === userId) group.ownerId = group.memberIds[0]
    store.persist()
    emitDm(group)
    systemMessage(group, text)
  }

  app.delete('/api/groups/:id/members/:userId', requireAuth, (req, res) => {
    const group = groupFor(req, res)
    if (!group) return
    const { user } = req as AuthedRequest
    const targetId = String(req.params.userId)
    if (group.ownerId !== user.id) return fail(res, 403, 'Исключать может только создатель группы')
    if (targetId === user.id) return fail(res, 400, 'Чтобы уйти самому, нажми «Покинуть группу»')
    if (!group.memberIds.includes(targetId)) return fail(res, 404, 'Такого участника нет')
    remove(group, targetId, `${nameOf(user.id)} исключил(а) из группы: ${nameOf(targetId)}`, 'removed')
    res.json({ dm: dmView(group, user.id) })
  })

  app.post('/api/groups/:id/leave', requireAuth, (req, res) => {
    const group = groupFor(req, res)
    if (!group) return
    const { user } = req as AuthedRequest
    remove(group, user.id, `${nameOf(user.id)} покинул(а) группу`, 'left')
    res.json({ ok: true })
  })
}
