import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { connectRealtime } from '../lib/realtime'
import { initVoice, resetVoice } from '../lib/voice'
import { activeChannelId, chat, useChat } from '../lib/store'
import { ui, useUi } from '../lib/ui'
import { msgUi } from '../lib/msgActions'
import { Dock } from './Dock'
import { HomeSidebar } from './HomeSidebar'
import { GuildSidebar } from './GuildSidebar'
import { FriendsPage } from './FriendsPage'
import { ChatView } from './ChatView'
import { MemberList } from './MemberList'
import { DmProfile } from './DmProfile'
import { Toasts } from './Toasts'
import { Modals } from './Modals'
import { ProfileCard } from './ProfileCard'
import { MiniSphere } from './MiniSphere'
import { Settings } from './settings/Settings'
import { ServerSettings } from './guild/ServerSettings'
import { ChannelModal } from './guild/ChannelModal'
import { GroupModal } from './groups/GroupModal'
import { IncomingCall } from './voice/IncomingCall'
import { VoiceChannelView } from './voice/VoiceChannelView'
import { EggLayer } from './eggs/EggLayer'
import { BadgeCelebration } from './badges/BadgeCelebration'
import { MessageMenu } from './chat/MessageMenu'
import { ForwardModal } from './chat/ForwardModal'

interface Props {
  onLogout: () => void
}

/** Латынь под сферой, пока грузимся: Nuntius — «вестник» по-латыни */
const QUOTES: [string, string][] = [
  ['Festina lente', 'Поспешай медленно'],
  ['Verba volant, scripta manent', 'Слова улетают, написанное остаётся'],
  ['Dum spiro, spero', 'Пока дышу — надеюсь'],
  ['Carpe diem', 'Лови момент'],
  ['Per aspera ad astra', 'Через тернии к звёздам'],
  ['Veni, vidi, vici', 'Пришёл, увидел, победил'],
  ['Memento mori', 'Помни о смерти (но сначала ответь на сообщения)'],
  ['Alea iacta est', 'Жребий брошен'],
  ['Tempus fugit', 'Время бежит'],
  ['Nuntius', 'Вестник — это ты'],
]

export function Shell({ onLogout }: Props) {
  const ready = useChat((s) => s.ready)
  const view = useChat((s) => s.view)
  const connected = useChat((s) => s.connected)
  const asideOpen = useUi((s) => s.asideOpen)
  const settingsOpen = useUi((s) => s.settings !== null || s.serverSettings !== null)
  // Открыт голосовой канал сервера — в середине «сцена» звонка вместо чата
  const voiceChannel = useChat((s) => {
    if (s.view.kind !== 'guild') return undefined
    const id = activeChannelId(s)
    const guild = s.guilds.find((g) => g.id === (s.view as { guildId: string }).guildId)
    const channel = guild?.channels.find((c) => c.id === id)
    return channel?.type === 'voice' ? channel : undefined
  })
  const viewGuild = useChat((s) => (s.view.kind === 'guild' ? s.guilds.find((g) => g.id === (s.view as { guildId: string }).guildId) : undefined))
  const totalUnread = useChat((s) => Object.values(s.unread).reduce((a, b) => a + b, 0))
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)])

  useEffect(() => {
    let alive = true
    api
      .state()
      .then((state) => {
        if (!alive) return
        chat.init(state)
        initVoice(state.voice, state.rings)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) onLogout()
      })
    const stop = connectRealtime(onLogout)
    return () => {
      alive = false
      resetVoice() // выход из аккаунта — выходим и из голоса
      stop()
      chat.reset()
      ui.reset() // иначе после выхода и нового входа сразу открылись бы настройки
      msgUi.reset()
    }
  }, [onLogout])

  // Вернулся во вкладку — открытый канал считается прочитанным
  useEffect(() => {
    const onVisible = () => !document.hidden && chat.markRead()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Nuntius` : 'Nuntius'
  }, [totalUnread])

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash__inner">
          <MiniSphere size={72} dots={140} />
          <p className="splash__quote">
            <i>{quote[0]}</i>
            <span>{quote[1]}</span>
          </p>
        </div>
      </div>
    )
  }

  const hasAside = view.kind !== 'home'

  return (
    <>
    <div className={`shell zoomed${hasAside && asideOpen ? ' shell--aside' : ''}${settingsOpen ? ' is-behind' : ''}`} aria-hidden={settingsOpen} inert={settingsOpen}>
      <Dock />
      {view.kind === 'guild' ? <GuildSidebar guildId={view.guildId} onLogout={onLogout} /> : <HomeSidebar onLogout={onLogout} />}
      {view.kind === 'home' ? (
        <FriendsPage tab={view.tab} />
      ) : voiceChannel && viewGuild ? (
        <VoiceChannelView guild={viewGuild} channel={voiceChannel} />
      ) : (
        <ChatView />
      )}
      {hasAside && (
        <div className={`aside-wrap${asideOpen ? ' is-open' : ''}`}>
          {view.kind === 'guild' ? <MemberList guildId={view.guildId} /> : <DmProfile dmId={view.dmId} />}
        </div>
      )}

      {!connected && <div className="conn-banner">Переподключаемся к серверу…</div>}
      <Modals />
      <GroupModal />
      <ForwardModal />
      <ProfileCard />
    </div>
    <Settings onLogout={onLogout} />
    <ServerSettings />
    {/* окно канала открывается и из настроек сервера — поэтому снаружи «затемнённой» оболочки и поверх настроек */}
    <div className="modal-layer zoomed">
      <ChannelModal />
    </div>
    {/* меню сообщения (правый клик) — порталом поверх всего */}
    <MessageMenu />
    <IncomingCall />
    {/* уведомления — поверх всего, в том числе поверх настроек */}
    <Toasts />
    <BadgeCelebration />
    <EggLayer />
    </>
  )
}
