import { CHANNEL_PERMISSIONS, type Channel, type Guild, type Permission, type Role } from './api'
import { useChat } from './store'

/**
 * Права на серверах (на клиенте — только чтобы прятать недоступные кнопки; проверяет всё сервер).
 * Итоговые права приходят готовыми: guild.perms — на сервере, channel.perms — в канале.
 */

export const myId = () => useChat.getState().me?.id ?? ''

/** Что значит каждое право — для настроек ролей и каналов */
export const PERMISSION_INFO: Record<Permission, { label: string; description: string }> = {
  ADMINISTRATOR: {
    label: 'Администратор',
    description: 'Может всё, что и владелец, кроме удаления сервера. Каналы и запреты на него не действуют — давай с осторожностью.',
  },
  MANAGE_SERVER: { label: 'Управлять сервером', description: 'Переименовывать сервер.' },
  MANAGE_ROLES: {
    label: 'Управлять ролями',
    description: 'Создавать и настраивать роли ниже своей, выдавать их людям и настраивать права в каналах.',
  },
  MANAGE_CHANNELS: { label: 'Управлять каналами', description: 'Создавать, переименовывать, двигать и удалять каналы.' },
  KICK_MEMBERS: { label: 'Выгонять участников', description: 'Убирать с сервера людей, чья роль ниже твоей. Вернуться они смогут по приглашению.' },
  CREATE_INVITE: { label: 'Приглашать', description: 'Видеть код приглашения и звать друзей на сервер.' },
  VIEW_CHANNEL: { label: 'Видеть каналы', description: 'Видеть канал и читать в нём сообщения. Без этого канала как будто нет.' },
  SEND_MESSAGES: { label: 'Отправлять сообщения', description: 'Писать в текстовых каналах.' },
  MANAGE_MESSAGES: { label: 'Управлять сообщениями', description: 'Удалять чужие сообщения.' },
  CONNECT: { label: 'Подключаться', description: 'Заходить в голосовые каналы.' },
  SPEAK: { label: 'Говорить', description: 'Без этого права в голосе можно только слушать.' },
  VIDEO: { label: 'Видео', description: 'Включать камеру и показывать экран.' },
  MUTE_MEMBERS: { label: 'Заглушать участников', description: 'Выключать другим микрофон в голосовом канале — для всех.' },
  MOVE_MEMBERS: { label: 'Отключать от голоса', description: 'Выкидывать людей из голосового канала.' },
}

/** Группы прав в настройках роли */
export const PERMISSION_GROUPS: { title: string; perms: Permission[] }[] = [
  { title: 'Общие', perms: ['ADMINISTRATOR', 'MANAGE_SERVER', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'KICK_MEMBERS', 'CREATE_INVITE'] },
  { title: 'Текст', perms: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES'] },
  { title: 'Голос', perms: ['CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'MOVE_MEMBERS'] },
]

/** Какие права настраиваются в канале каждого типа */
export const CHANNEL_PERMS_BY_TYPE: Record<Channel['type'], Permission[]> = {
  text: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES'],
  voice: ['VIEW_CHANNEL', 'CONNECT', 'SPEAK', 'VIDEO', 'MUTE_MEMBERS', 'MOVE_MEMBERS'],
}

/** Палитра цветов ролей (null — без цвета) */
export const ROLE_COLORS: (string | null)[] = [
  null,
  '#ffffff',
  '#a8a8a8',
  '#ff6b6b',
  '#ff9f43',
  '#ffd43b',
  '#69db7c',
  '#38d9a9',
  '#4dabf7',
  '#748ffc',
  '#b197fc',
  '#f783ac',
]

export const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v)

const LEGACY_EVERYONE: Permission[] = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'CREATE_INVITE']

export const isOwner =(guild: Guild | undefined, userId = myId()) => Boolean(guild && userId && guild.ownerId === userId)

/** Есть ли у меня право на сервере (или в канале, если передан channelId) */
export function can(guild: Guild | undefined, perm: Permission, channelId?: string): boolean {
  if (!guild) return false
  if (isOwner(guild)) return true
  // Старый сервер без ролей: управлять может только владелец, остальным — то, что есть у всех
  if (!Array.isArray(guild.perms)) return LEGACY_EVERYONE.includes(perm)
  if (guild.perms.includes('ADMINISTRATOR')) return true
  if (channelId === undefined || !CHANNEL_PERMISSIONS.includes(perm)) return guild.perms.includes(perm)
  const channel = guild.channels.find((c) => c.id === channelId)
  // Канала нет в списке — значит, его нам не видно
  if (!channel) return false
  if (!Array.isArray(channel.perms)) return guild.perms.includes(perm)
  return channel.perms.includes(perm)
}

/** Роль @everyone (id совпадает с id сервера) */
export const everyoneOf = (guild: Guild): Role | undefined => guild.roles?.find((r) => r.id === guild.id)

export const isEveryone = (guild: Guild, role: Role | string) => (typeof role === 'string' ? role : role.id) === guild.id

/** Роли участника, от высшей к низшей (без @everyone) */
export function rolesOf(guild: Guild | undefined, userId: string): Role[] {
  if (!guild?.roles) return []
  const ids = guild.memberRoles?.[userId]
  if (!ids?.length) return []
  return guild.roles.filter((r) => r.id !== guild.id && ids.includes(r.id)).sort((a, b) => b.position - a.position)
}

/** Цвет имени участника — цвет его высшей цветной роли */
export function roleColor(guild: Guild | undefined, userId: string): string | null {
  return rolesOf(guild, userId).find((r) => r.color)?.color ?? null
}

/** Высшая роль, которую показывают отдельной группой в списке участников */
export const hoistedRoleOf = (guild: Guild | undefined, userId: string): Role | undefined => rolesOf(guild, userId).find((r) => r.hoist)

/** Положение самой высокой роли участника (у владельца — выше всех) */
export function highestPosition(guild: Guild | undefined, userId = myId()): number {
  if (!guild) return 0
  if (guild.ownerId === userId) return Infinity
  return rolesOf(guild, userId)[0]?.position ?? 0
}

/** Можно ли мне менять / выдавать / удалять эту роль (как на сервере: только роли ниже своей высшей) */
export function canManageRole(guild: Guild | undefined, role: Role): boolean {
  if (!guild) return false
  if (isOwner(guild)) return true
  if (!can(guild, 'MANAGE_ROLES')) return false
  if (isEveryone(guild, role)) return true
  return role.position < highestPosition(guild)
}

/** Можно ли выдать роли это право: давать можно только то, что есть у самого (владельцу и администратору — всё) */
export const canGrant = (guild: Guild | undefined, perm: Permission) => can(guild, 'ADMINISTRATOR') || can(guild, perm)

/** Можно ли применить ко мне/к человеку силу: выгнать, заглушить, отключить (его роль должна быть ниже моей) */
export function outranks(guild: Guild | undefined, targetId: string): boolean {
  if (!guild) return false
  const me = myId()
  if (!me || targetId === me || targetId === guild.ownerId) return false
  if (isOwner(guild)) return true
  return highestPosition(guild, targetId) < highestPosition(guild, me)
}

/** Сколько людей с этой ролью (у @everyone — все участники) */
export function roleMemberCount(guild: Guild, roleId: string): number {
  if (roleId === guild.id) return guild.members.length
  return guild.members.filter((m) => guild.memberRoles?.[m.id]?.includes(roleId)).length
}

/** Канал закрыт от всех (@everyone не видит) — рисуем замочек */
export const isPrivateChannel = (guild: Guild, channel: Channel) => Boolean(channel.overrides?.[guild.id]?.deny.includes('VIEW_CHANNEL'))

/** Сервер, которому принадлежит канал (голосовая комната) — для личек и групп undefined */
export const guildOfChannel = (guilds: Guild[], channelId: string | null | undefined) =>
  channelId ? guilds.find((g) => g.channels.some((c) => c.id === channelId)) : undefined
