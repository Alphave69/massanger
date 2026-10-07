import { chat, dmTitle, useChat } from './store'

/** Где находится голосовая комната: канал сервера или личка/группа — для подписей и перехода */
export function describeRoom(roomId: string) {
  const st = useChat.getState()
  for (const guild of st.guilds) {
    const channel = guild.channels.find((c) => c.id === roomId)
    if (channel) return { kind: 'guild' as const, title: channel.name, subtitle: guild.name, guildId: guild.id, channelId: channel.id }
  }
  const dm = st.dms.find((d) => d.id === roomId)
  if (dm) return { kind: 'dm' as const, title: dmTitle(st, dm), subtitle: dm.kind === 'group' ? 'Групповой звонок' : 'Личный звонок', dmId: dm.id }
  return null
}

/** Открыть экран комнаты */
export function openRoom(roomId: string) {
  const where = describeRoom(roomId)
  if (!where) return
  if (where.kind === 'guild') chat.openGuildChannel(where.guildId, where.channelId)
  else chat.setView({ kind: 'dm', dmId: where.dmId })
}
