import type { Express, Request, Response } from 'express'
import { requireAuth, type AuthedRequest } from './auth.js'
import * as store from './store.js'
import type { Voice } from './voice.js'
import { channelFor, guildFor, type Fail } from './guilds.js'
import { serializeGuild } from './guildView.js'
import {
  canManageRole,
  changedPermissions,
  channelPermissions,
  findRole,
  guildPermissions,
  highestPosition,
  isChannelPermission,
  isEveryone,
  isGuildAdmin,
  isPermission,
  missingPermissions,
  normalizePositions,
  permList,
  sortedRoles,
  type Permission,
} from './permissions.js'

/**
 * Роли сервера и права каналов: создать / изменить / подвинуть / удалить роль,
 * выдать роли участнику, исключения для роли в канале.
 * Всё требует «Управления ролями» и уважает иерархию: трогать можно только роли ниже своей самой высокой.
 */

interface Deps {
  voice: Voice
  fail: Fail
  /** Разослать сервер всем участникам — каждому свою версию */
  emitGuild: (guild: store.Guild) => void
}

export const MAX_ROLES = 50
const COLOR_RE = /^#[0-9a-f]{6}$/i
const DEFAULT_NAME = 'новая роль'

/** Список прав из тела запроса (null — это вообще не список); лишнее и повторы отбрасываем */
function permsFrom(raw: unknown, only: (p: unknown) => p is Permission = isPermission): Permission[] | null {
  if (!Array.isArray(raw)) return null
  return permList(raw.filter(only))
}

type RoleFields = Partial<Pick<store.Role, 'name' | 'color' | 'hoist' | 'permissions'>>

/** Поля роли из тела запроса; строка — текст ошибки */
function roleFields(body: Record<string, unknown>): RoleFields | string {
  const out: RoleFields = {}
  const { name, color, hoist, permissions } = body
  if (name !== undefined) {
    const clean = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 32) : ''
    if (!clean) return 'Укажи название роли'
    out.name = clean
  }
  if (color !== undefined) {
    if (color !== null && (typeof color !== 'string' || !COLOR_RE.test(color))) return 'Цвет роли — в формате #rrggbb'
    out.color = color === null ? null : color.toLowerCase()
  }
  if (hoist !== undefined) {
    if (typeof hoist !== 'boolean') return 'Неверная настройка «Показывать отдельно»'
    out.hoist = hoist
  }
  if (permissions !== undefined) {
    const perms = permsFrom(permissions)
    if (!perms) return 'Неверный список прав'
    out.permissions = perms
  }
  return out
}

/** Раздавать и отнимать можно только те права, что есть у тебя самого (владельцу и «Администратору» — любые) */
function grantProblem(guild: store.Guild, userId: string, touched: Permission[], have: Set<Permission>) {
  if (!touched.length || isGuildAdmin(guild, userId)) return null
  return missingPermissions(have, touched).length ? 'Нельзя выдавать или снимать права, которых нет у тебя самого' : null
}

export function registerRoleRoutes(app: Express, { voice, fail, emitGuild }: Deps) {
  const userOf = (req: Request) => (req as AuthedRequest).user

  /** Права на сервере поменялись: сохранить, разослать всем их вид сервера и перепроверить голос */
  function changed(guild: store.Guild) {
    store.persist()
    emitGuild(guild)
    voice.recheckGuild(guild)
  }

  /** Роль из :roleId, которую человек может менять. Иначе — ответ с ошибкой и undefined */
  function manageableRole(guild: store.Guild, req: Request, res: Response) {
    const role = findRole(guild, String(req.params.roleId))
    if (!role) return void fail(res, 404, 'Роль не найдена')
    if (!canManageRole(guild, userOf(req).id, role)) {
      const why = isEveryone(guild, role) ? 'Чтобы менять @everyone, нужна своя роль с правом управлять ролями' : 'Эта роль не ниже твоей — менять её нельзя'
      return void fail(res, 403, why)
    }
    return role
  }

  app.post('/api/guilds/:id/roles', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_ROLES')
    if (!guild) return
    const user = userOf(req)
    if (guild.roles.length - 1 >= MAX_ROLES) return fail(res, 400, `На сервере уже ${MAX_ROLES} ролей — это максимум`)
    const fields = roleFields(req.body ?? {})
    if (typeof fields === 'string') return fail(res, 400, fields)
    const problem = grantProblem(guild, user.id, fields.permissions ?? [], guildPermissions(guild, user.id))
    if (problem) return fail(res, 403, problem)

    // Новая роль встаёт сразу под самой высокой ролью создателя (у владельца — на самый верх)
    normalizePositions(guild)
    const top = highestPosition(guild, user.id)
    if (top <= 0) return fail(res, 403, 'Новая роль встаёт под твоей самой высокой — а своих ролей у тебя пока нет')
    let position = guild.roles.length // выше всех: у остальных позиции 1…n, где n = ролей без @everyone
    if (top !== Infinity) {
      position = top
      for (const r of guild.roles) if (!isEveryone(guild, r) && r.position >= top) r.position++
    }
    const role: store.Role = {
      id: store.id(),
      name: fields.name ?? DEFAULT_NAME,
      color: fields.color ?? null,
      hoist: fields.hoist ?? false,
      permissions: fields.permissions ?? [],
      position,
    }
    guild.roles.push(role)
    changed(guild)
    res.json({ guild: serializeGuild(guild, user.id), role })
  })

  app.patch('/api/guilds/:id/roles/:roleId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_ROLES')
    if (!guild) return
    const role = manageableRole(guild, req, res)
    if (!role) return
    const user = userOf(req)
    const fields = roleFields(req.body ?? {})
    if (typeof fields === 'string') return fail(res, 400, fields)
    const move: unknown = req.body?.move
    if (move !== undefined && move !== -1 && move !== 1) return fail(res, 400, 'Роль двигается на одну ступень: вверх или вниз')

    const everyone = isEveryone(guild, role)
    if (everyone) {
      // у @everyone меняются только права (если клиент прислал роль целиком — остальное должно совпадать)
      const other =
        (fields.name !== undefined && fields.name !== role.name) ||
        (fields.color !== undefined && fields.color !== role.color) ||
        (fields.hoist !== undefined && fields.hoist !== role.hoist) ||
        move !== undefined
      if (other) return fail(res, 400, 'У @everyone можно менять только права')
    }
    if (fields.permissions) {
      const problem = grantProblem(guild, user.id, changedPermissions(role.permissions, fields.permissions), guildPermissions(guild, user.id))
      if (problem) return fail(res, 403, problem)
    }

    // Сдвиг — обмен местами с соседней ролью; поднять выше роли, которую не можешь менять, нельзя
    let swap: store.Role | undefined
    if (move === -1 || move === 1) {
      normalizePositions(guild)
      const order = sortedRoles(guild).filter((r) => !isEveryone(guild, r)) // сверху вниз
      swap = order[order.indexOf(role) + move]
      if (swap && !canManageRole(guild, user.id, swap)) return fail(res, 403, 'Выше своей самой высокой роли поднять нельзя')
    }

    if (swap) [role.position, swap.position] = [swap.position, role.position]
    if (!everyone) {
      if (fields.name !== undefined) role.name = fields.name
      if (fields.color !== undefined) role.color = fields.color
      if (fields.hoist !== undefined) role.hoist = fields.hoist
    }
    if (fields.permissions) role.permissions = fields.permissions
    changed(guild)
    res.json({ guild: serializeGuild(guild, user.id) })
  })

  app.delete('/api/guilds/:id/roles/:roleId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_ROLES')
    if (!guild) return
    if (String(req.params.roleId) === guild.id) return fail(res, 400, '@everyone удалить нельзя — эта роль есть у всех')
    const role = manageableRole(guild, req, res)
    if (!role) return
    guild.roles = guild.roles.filter((r) => r !== role)
    // вместе с ролью уходят её выдачи и исключения в каналах
    for (const [userId, ids] of Object.entries(guild.memberRoles)) {
      const left = ids.filter((id) => id !== role.id)
      if (left.length) guild.memberRoles[userId] = left
      else delete guild.memberRoles[userId]
    }
    for (const channel of guild.channels) delete channel.overrides[role.id]
    normalizePositions(guild)
    changed(guild)
    res.json({ guild: serializeGuild(guild, userOf(req).id) })
  })

  /** Роли участника целиком: менять можно только роли ниже своей, остальные его роли остаются как были */
  app.put('/api/guilds/:id/members/:userId/roles', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_ROLES')
    if (!guild) return
    const user = userOf(req)
    const targetId = String(req.params.userId)
    if (!guild.memberIds.includes(targetId)) return fail(res, 404, 'Такого участника нет')
    const raw: unknown = req.body?.roleIds
    if (!Array.isArray(raw)) return fail(res, 400, 'Неверный список ролей')
    const wanted = new Set(raw.filter((v): v is string => typeof v === 'string'))
    const current = new Set(guild.memberRoles[targetId] ?? [])

    const roles = sortedRoles(guild).filter((r) => !isEveryone(guild, r))
    if (roles.some((r) => wanted.has(r.id) && !current.has(r.id) && !canManageRole(guild, user.id, r))) {
      return fail(res, 403, 'Эту роль выдать нельзя — она не ниже твоей')
    }
    const next = roles.filter((r) => (canManageRole(guild, user.id, r) ? wanted.has(r.id) : current.has(r.id))).map((r) => r.id)
    if (next.length) guild.memberRoles[targetId] = next
    else delete guild.memberRoles[targetId]
    changed(guild)
    res.json({ guild: serializeGuild(guild, user.id) })
  })

  /** Исключения для роли в канале: allow/deny только из прав канала; пустые оба — исключение убираем */
  app.put('/api/guilds/:id/channels/:channelId/overrides/:roleId', requireAuth, (req, res) => {
    const guild = guildFor(req, res, fail, 'MANAGE_ROLES')
    if (!guild) return
    const channel = channelFor(guild, req, res, fail)
    if (!channel) return
    const user = userOf(req)
    const role = findRole(guild, String(req.params.roleId))
    if (!role) return fail(res, 404, 'Роль не найдена')
    if (!isEveryone(guild, role) && !canManageRole(guild, user.id, role)) return fail(res, 403, 'Эта роль не ниже твоей — её права в канале менять нельзя')

    const deny = permsFrom(req.body?.deny ?? [], isChannelPermission)
    const allowed = permsFrom(req.body?.allow ?? [], isChannelPermission)
    if (!deny || !allowed) return fail(res, 400, 'Неверный список прав')
    const allow = allowed.filter((p) => !deny.includes(p)) // запрет сильнее

    // Трогать можно только права, которые есть у тебя самого в этом канале
    const before = channel.overrides[role.id] ?? { allow: [], deny: [] }
    const touched = permList([...changedPermissions(before.allow, allow), ...changedPermissions(before.deny, deny)])
    const problem = grantProblem(guild, user.id, touched, channelPermissions(guild, channel, user.id))
    if (problem) return fail(res, 403, problem)

    if (allow.length || deny.length) channel.overrides[role.id] = { allow, deny }
    else delete channel.overrides[role.id]
    changed(guild)
    res.json({ guild: serializeGuild(guild, user.id) })
  })
}
