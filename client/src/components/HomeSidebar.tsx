import { Users } from 'lucide-react'
import { STATUS_LABEL } from '../lib/status'
import { chat, presenceOf, useChat, type DmRef } from '../lib/store'
import { isOnline } from '../lib/status'
import { Avatar } from './Avatar'
import { UserBar } from './UserBar'

export function HomeSidebar({ onLogout }: { onLogout: () => void }) {
  const view = useChat((s) => s.view)
  const dms = useChat((s) => s.dms)
  const friends = useChat((s) => s.friends)
  const presence = useChat((s) => s.presence)

  const requests = friends.filter((f) => f.state === 'incoming').length
  const accepted = friends.filter((f) => f.state === 'friends')
  const onlineFriends = accepted.filter((f) => isOnline(presence[f.userId])).length
  const sorted = [...dms].sort((a, b) => b.lastMessageAt - a.lastMessageAt)

  return (
    <aside className="side panel glow">
      <header className="side__head">
        <h2 className="side__title">Личное</h2>
        <span className="side__meta">
          {accepted.length} друзей · {onlineFriends} в сети
        </span>
      </header>

      <div className="side__scroll">
        <button className={`nav-item${view.kind === 'home' ? ' is-active' : ''}`} onClick={() => chat.setView({ kind: 'home', tab: 'online' })}>
          <Users size={18} />
          <span>Друзья</span>
          {requests > 0 && <span className="count-badge">{requests}</span>}
        </button>

        <div className="side__label">
          <span>Личные сообщения</span>
        </div>

        {sorted.length === 0 && <p className="side__empty">Здесь появятся переписки. Открой друга и нажми «Написать» ✦</p>}
        {sorted.map((d, i) => (
          <DmRow key={d.id} dm={d} active={view.kind === 'dm' && view.dmId === d.id} index={i} />
        ))}
      </div>

      <UserBar onLogout={onLogout} />
    </aside>
  )
}

function DmRow({ dm, active, index }: { dm: DmRef; active: boolean; index: number }) {
  const user = useChat((s) => s.users[dm.userId])
  const status = useChat((s) => presenceOf(s, dm.userId))
  const unread = useChat((s) => s.unread[dm.id] ?? 0)
  const typing = useChat((s) => Boolean(s.typing[dm.id]?.[dm.userId]))
  if (!user) return null

  return (
    <button
      className={`dm-row${active ? ' is-active' : ''}${unread ? ' has-unread' : ''}`}
      style={{ animationDelay: `${index * 40}ms` }}
      onClick={() => chat.setView({ kind: 'dm', dmId: dm.id })}
    >
      <Avatar user={user} size={34} status={status} />
      <span className="dm-row__text">
        <span className="dm-row__name truncate">{user.displayName}</span>
        <span className={`dm-row__sub truncate${typing ? ' is-typing' : ''}`}>
          {typing ? 'печатает…' : user.customStatus || STATUS_LABEL[status]}
        </span>
      </span>
      {unread > 0 && <span className="count-badge">{unread}</span>}
    </button>
  )
}
