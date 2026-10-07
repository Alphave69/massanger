import { useEffect } from 'react'
import { api, ApiError, getToken } from '../lib/api'
import { connectRealtime } from '../lib/realtime'
import { chat, useChat } from '../lib/store'
import { useUi } from '../lib/ui'
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

interface Props {
  onLogout: () => void
}

export function Shell({ onLogout }: Props) {
  const ready = useChat((s) => s.ready)
  const view = useChat((s) => s.view)
  const connected = useChat((s) => s.connected)
  const asideOpen = useUi((s) => s.asideOpen)
  const totalUnread = useChat((s) => Object.values(s.unread).reduce((a, b) => a + b, 0))

  useEffect(() => {
    let alive = true
    api
      .state()
      .then((state) => alive && chat.init(state))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) onLogout()
      })
    const stop = connectRealtime(getToken() ?? '', onLogout)
    return () => {
      alive = false
      stop()
      chat.reset()
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
        <MiniSphere size={72} dots={140} />
      </div>
    )
  }

  const hasAside = view.kind !== 'home'

  return (
    <div className={`shell${hasAside && asideOpen ? ' shell--aside' : ''}`}>
      <Dock />
      {view.kind === 'guild' ? <GuildSidebar guildId={view.guildId} onLogout={onLogout} /> : <HomeSidebar onLogout={onLogout} />}
      {view.kind === 'home' ? <FriendsPage tab={view.tab} /> : <ChatView />}
      {hasAside && (
        <div className={`aside-wrap${asideOpen ? ' is-open' : ''}`}>
          {view.kind === 'guild' ? <MemberList guildId={view.guildId} /> : <DmProfile dmId={view.dmId} />}
        </div>
      )}

      {!connected && <div className="conn-banner">Переподключаемся к серверу…</div>}
      <Toasts />
      <Modals />
      <ProfileCard />
    </div>
  )
}
