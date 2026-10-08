import type { Server } from 'socket.io'
import * as store from './store.js'
import { channelPermissions, guildPermissions, permList, sortedRoles, type Permission } from './permissions.js'

/**
 * Как сервер выглядит для конкретного человека: у каждого свои права,
 * а значит — свой набор видимых каналов. Поэтому сервер всегда отдаём «на человека».
 */

/** Общая для всех часть (участники, роли) — считаем один раз на рассылку */
function sharedPart(guild: store.Guild) {
  return {
    id: guild.id,
    name: guild.name,
    ownerId: guild.ownerId,
    isLobby: Boolean(guild.isLobby),
    members: guild.memberIds.map(store.findUser).filter((u) => u !== undefined).map(store.publicUser),
    /** Сверху вниз, @everyone — последней */
    roles: sortedRoles(guild),
    memberRoles: guild.memberRoles,
  }
}

/** Канал вместе с итоговыми правами человека в нём */
export const channelView = (channel: store.Channel, perms: Iterable<Permission>) => ({
  id: channel.id,
  name: channel.name,
  type: channel.type,
  overrides: channel.overrides,
  perms: permList(perms),
})
export type ChannelView = ReturnType<typeof channelView>

/** Сервер глазами человека: только каналы, которые он видит (VIEW_CHANNEL), и его права */
export function serializeGuild(guild: store.Guild, userId: string, shared = sharedPart(guild)) {
  const channels: ChannelView[] = []
  for (const channel of guild.channels) {
    const perms = channelPermissions(guild, channel, userId)
    if (perms.has('VIEW_CHANNEL')) channels.push(channelView(channel, perms))
  }
  return { ...shared, channels, perms: permList(guildPermissions(guild, userId)) }
}
export type GuildView = ReturnType<typeof serializeGuild>

/** Разослать сервер всем участникам — каждому свою версию */
export function broadcastGuild(io: Server, guild: store.Guild) {
  const shared = sharedPart(guild)
  for (const id of guild.memberIds) io.to(`user:${id}`).emit('guild:update', serializeGuild(guild, id, shared))
}
