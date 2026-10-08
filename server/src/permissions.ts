import type { Channel, Guild, Role } from './store.js'

/**
 * Права на серверах — как в Discord: у сервера есть роли, у роли — набор прав,
 * у канала — точечные исключения (разрешить / запретить) для отдельных ролей.
 *
 * Роль @everyone есть у каждого участника, её id совпадает с id сервера.
 * Владелец сервера может всё, «Администратор» — тоже всё (кроме удаления сервера).
 *
 * Здесь только расчёты (без сокетов и HTTP) — store.ts импортирует отсюда константы,
 * поэтому из store берём лишь типы.
 */

export const PERMISSIONS = [
  'ADMINISTRATOR',
  'MANAGE_SERVER',
  'MANAGE_ROLES',
  'MANAGE_CHANNELS',
  'KICK_MEMBERS',
  'CREATE_INVITE',
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'MANAGE_MESSAGES',
  'CONNECT',
  'SPEAK',
  'VIDEO',
  'MUTE_MEMBERS',
  'MOVE_MEMBERS',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** Права, которые можно выставить отдельному каналу (остальные действуют на весь сервер) */
export const CHANNEL_PERMISSIONS: Permission[] = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'MOVE_MEMBERS']

/** Что по умолчанию может любой участник (@everyone) */
export const DEFAULT_EVERYONE: Permission[] = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'CREATE_INVITE']

export const isPermission = (p: unknown): p is Permission => typeof p === 'string' && (PERMISSIONS as readonly string[]).includes(p)

export const isChannelPermission = (p: unknown): p is Permission => isPermission(p) && CHANNEL_PERMISSIONS.includes(p)

const all = () => new Set<Permission>(PERMISSIONS)

/** Набор прав → массив в каноническом порядке (для ответа клиенту) */
export const permList = (perms: Iterable<Permission>): Permission[] => {
  const set = new Set(perms)
  return PERMISSIONS.filter((p) => set.has(p))
}

// ============ роли участника ============

export const isEveryone = (guild: Guild, role: Role) => role.id === guild.id

export const everyoneOf = (guild: Guild) => guild.roles.find((r) => r.id === guild.id)

export const findRole = (guild: Guild, roleId: string) => guild.roles.find((r) => r.id === roleId)

/** Роли сервера сверху вниз: самая высокая первой, @everyone — последней */
export function sortedRoles(guild: Guild): Role[] {
  const key = (r: Role) => (isEveryone(guild, r) ? -1 : r.position)
  return [...guild.roles].sort((a, b) => key(b) - key(a))
}

/** Роли участника (без @everyone и без давно удалённых id) */
export function rolesOf(guild: Guild, userId: string): Role[] {
  const ids = guild.memberRoles[userId]
  if (!ids?.length) return []
  return guild.roles.filter((r) => !isEveryone(guild, r) && ids.includes(r.id))
}

/** Позиция самой высокой роли участника; у владельца — бесконечность, без ролей — 0 (как @everyone) */
export function highestPosition(guild: Guild, userId: string): number {
  if (guild.ownerId === userId) return Infinity
  return Math.max(0, ...rolesOf(guild, userId).map((r) => r.position))
}

/** Перенумеровать роли подряд: @everyone — 0, остальные 1…n снизу вверх */
export function normalizePositions(guild: Guild) {
  const others = guild.roles.filter((r) => !isEveryone(guild, r)).sort((a, b) => a.position - b.position)
  others.forEach((r, i) => (r.position = i + 1))
  const everyone = everyoneOf(guild)
  if (everyone) everyone.position = 0
}

// ============ расчёт прав ============

/** Права участника на всём сервере: @everyone + все его роли. Владелец и «Администратор» — всё */
export function guildPermissions(guild: Guild, userId: string): Set<Permission> {
  if (guild.ownerId === userId) return all()
  if (!guild.memberIds.includes(userId)) return new Set()
  const out = new Set<Permission>(everyoneOf(guild)?.permissions ?? [])
  for (const role of rolesOf(guild, userId)) for (const p of role.permissions) out.add(p)
  return out.has('ADMINISTRATOR') ? all() : out
}

/**
 * Права в канале: права на сервере, потом исключения канала —
 * сначала для @everyone, потом для ролей участника (запреты всех его ролей, затем разрешения).
 * Исключения трогают только права канала (CHANNEL_PERMISSIONS).
 */
export function channelPermissions(guild: Guild, channel: Channel, userId: string): Set<Permission> {
  const out = guildPermissions(guild, userId)
  if (guild.ownerId === userId || out.has('ADMINISTRATOR')) return out

  const apply = (deny: Permission[], allow: Permission[]) => {
    for (const p of deny) if (CHANNEL_PERMISSIONS.includes(p)) out.delete(p)
    for (const p of allow) if (CHANNEL_PERMISSIONS.includes(p)) out.add(p)
  }
  const everyone = channel.overrides[guild.id]
  if (everyone) apply(everyone.deny, everyone.allow)

  const deny: Permission[] = []
  const allow: Permission[] = []
  for (const role of rolesOf(guild, userId)) {
    const o = channel.overrides[role.id]
    if (!o) continue
    deny.push(...o.deny)
    allow.push(...o.allow)
  }
  apply(deny, allow)

  // Канал не виден — остальные права в нём тоже не действуют (как в Discord)
  if (!out.has('VIEW_CHANNEL')) for (const p of CHANNEL_PERMISSIONS) out.delete(p)
  return out
}

export const hasGuildPermission = (guild: Guild, userId: string, perm: Permission) => guildPermissions(guild, userId).has(perm)

export const hasChannelPermission = (guild: Guild, channel: Channel, userId: string, perm: Permission) =>
  channelPermissions(guild, channel, userId).has(perm)

/** Видит ли участник канал */
export const canView = (guild: Guild, channel: Channel, userId: string) => hasChannelPermission(guild, channel, userId, 'VIEW_CHANNEL')

/** Владелец или «Администратор»: может выдавать любые права */
export const isGuildAdmin = (guild: Guild, userId: string) => guild.ownerId === userId || hasGuildPermission(guild, userId, 'ADMINISTRATOR')

// ============ иерархия ============

/** Может ли человек менять / удалять / двигать / выдавать роль: «Управление ролями» и роль строго ниже его самой высокой */
export function canManageRole(guild: Guild, actorId: string, role: Role): boolean {
  if (guild.ownerId === actorId) return true
  return hasGuildPermission(guild, actorId, 'MANAGE_ROLES') && role.position < highestPosition(guild, actorId)
}

/** Стоит ли actor выше target: владелец — выше всех, владельца не трогает никто, иначе — по самой высокой роли */
export function outranks(guild: Guild, actorId: string, targetId: string): boolean {
  if (guild.ownerId === actorId) return true
  if (guild.ownerId === targetId) return false
  return highestPosition(guild, targetId) < highestPosition(guild, actorId)
}

/** Можно ли выгнать: право «Выгонять», не себя, не владельца и только тех, кто ниже */
export const canKick = (guild: Guild, actorId: string, targetId: string) =>
  actorId !== targetId && targetId !== guild.ownerId && hasGuildPermission(guild, actorId, 'KICK_MEMBERS') && outranks(guild, actorId, targetId)

/** Каких прав из списка у человека нет (нельзя раздавать то, чего нет у самого себя) */
export const missingPermissions = (have: Set<Permission>, perms: Iterable<Permission>) => [...new Set(perms)].filter((p) => !have.has(p))

/** Права, которые различаются у двух наборов (что именно человек пытается поменять) */
export const changedPermissions = (before: Iterable<Permission>, after: Iterable<Permission>) => {
  const a = new Set(before)
  const b = new Set(after)
  return permList([...a].filter((p) => !b.has(p)).concat([...b].filter((p) => !a.has(p))))
}

// ============ тексты ошибок ============

const NO_PERMISSION: Record<Permission, string> = {
  ADMINISTRATOR: 'Это может только администратор сервера',
  MANAGE_SERVER: 'Нет права управлять сервером',
  MANAGE_ROLES: 'Нет права управлять ролями',
  MANAGE_CHANNELS: 'Нет права управлять каналами',
  KICK_MEMBERS: 'Нет права выгонять участников',
  CREATE_INVITE: 'Нет права приглашать людей',
  VIEW_CHANNEL: 'Нет доступа к этому каналу',
  SEND_MESSAGES: 'Нет прав писать в этом канале',
  MANAGE_MESSAGES: 'Нет права удалять чужие сообщения',
  CONNECT: 'Нет доступа к этому каналу',
  SPEAK: 'Нет права говорить в этом канале',
  VIDEO: 'Нет прав на видео в этом канале',
  MUTE_MEMBERS: 'Нет права заглушать участников',
  MOVE_MEMBERS: 'Нет права отключать участников от голоса',
}

/** Понятный текст «нет права …» для ответа клиенту */
export const noPermission = (perm: Permission) => NO_PERMISSION[perm]
