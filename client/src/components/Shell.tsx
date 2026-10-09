import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { connectRealtime } from '../lib/realtime'
import { initVoice, resetVoice } from '../lib/voice'
import { activeChannelId, chat, useChat } from '../lib/store'
import { ui, useUi } from '../lib/ui'
import { msgUi, useMsgUi } from '../lib/msgActions'
import { isMobile, trackBackButton, trackViewport, useIsMobile } from '../lib/mobile'
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

/** Телефон: открыто что-то, что закрывает кнопка «Назад» (окно, шторка, настройки, панель справа, сам чат) */
function hasOpenLayer() {
  const u = useUi.getState()
  const m = useMsgUi.getState()
  return Boolean(
    m.menu || m.forward || u.channelModal || u.groupModal || u.modal || u.profile || u.settings || u.serverSettings || u.asideOpen || u.mobileMain,
  )
}

/** «Назад» на телефоне: закрываем то, что лежит сверху */
function closeTopLayer() {
  const u = useUi.getState()
  const m = useMsgUi.getState()
  if (m.menu) msgUi.closeMenu()
  else if (m.forward) msgUi.closeForward()
  else if (u.channelModal) ui.closeChannelModal()
  else if (u.groupModal) ui.closeGroupModal()
  else if (u.modal) ui.closeModal()
  else if (u.profile) ui.hideProfile()
  // в настройках — сначала из раздела к списку разделов, потом закрыть
  else if ((u.serverSettings || u.settings) && !u.settingsList) ui.settingsBack()
  else if (u.serverSettings) ui.closeServerSettings()
  else if (u.settings) ui.closeSettings()
  else if (u.asideOpen) ui.closeAside()
  else ui.showNav()
}

export function Shell({ onLogout }: Props) {
  const ready = useChat((s) => s.ready)
  const view = useChat((s) => s.view)
  const connected = useChat((s) => s.connected)
  const asideOpen = useUi((s) => s.asideOpen)
  const mobileMain = useUi((s) => s.mobileMain)
  const mobile = useIsMobile()
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
    // (на телефоне — только если на экране сам чат, а не список)
    const onVisible = () => !document.hidden && (!isMobile() || useUi.getState().mobileMain) && chat.markRead()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) Nuntius` : 'Nuntius'
  }, [totalUnread])

  // Телефон: место над клавиатурой и кнопка «Назад» (закрывает открытое, из чата — к списку, а не уводит с сайта)
  useEffect(() => trackViewport(), [])
  useEffect(() => {
    const back = trackBackButton(hasOpenLayer, closeTopLayer)
    const offUi = useUi.subscribe(back.sync)
    const offMsg = useMsgUi.subscribe(back.sync)
    return () => {
      offUi()
      offMsg()
      back.stop()
    }
  }, [])

  useEffect(
    () =>
      useChat.subscribe((s, prev) => {
        if (!isMobile() || !s.ready || !prev.ready) return
        // Непрочитанное на телефоне со списка считает сам addMessage — чат не на экране
        // Открыли личку или канал откуда угодно (профиль, пересылка, новый канал) — показываем сам чат.
        // Щелчок по серверу в доке меняет только сервер — тогда остаёмся в списке его каналов
        const v = s.view
        const p = prev.view
        if (v.kind === 'dm' && (p.kind !== 'dm' || p.dmId !== v.dmId)) ui.showMain()
        else if (v.kind === 'guild' && s.channelByGuild !== prev.channelByGuild) ui.showMain()
      }),
    [],
  )

  // Телефон: чат выехал на экран — его сообщения прочитаны
  useEffect(
    () =>
      useUi.subscribe((s, prev) => {
        if (s.mobileMain && !prev.mobileMain && !document.hidden) chat.markRead()
      }),
    [],
  )

  // Окно сузилось до телефонного — правая колонка не должна сразу закрывать чат
  useEffect(() => {
    if (mobile) ui.closeAside()
  }, [mobile])

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
    <div
      className={`shell zoomed${hasAside && asideOpen ? ' shell--aside' : ''}${settingsOpen ? ' is-behind' : ''}${mobileMain ? ' shell--main' : ' shell--nav'}`}
      aria-hidden={settingsOpen}
      inert={settingsOpen}
    >
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
      {/* телефон: затемнение под выехавшей правой панелью — нажатие закрывает её */}
      {mobile && hasAside && <div className={`aside-backdrop${asideOpen ? ' is-open' : ''}`} onClick={ui.closeAside} aria-hidden="true" />}

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
