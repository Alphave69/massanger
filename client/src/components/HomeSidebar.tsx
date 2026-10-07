import { Phone, Plus, Users } from 'lucide-react'
import { STATUS_LABEL, isOnline } from '../lib/status'
import { chat, dmTitle, presenceOf, useChat, type DmRef } from '../lib/store'
import { ui } from '../lib/ui'
import { useVoice } from '../lib/voice'
import { Avatar } from './Avatar'
import { GroupAvatar } from './groups/GroupAvatar'
import { UserBar } from './UserBar'
import { VoicePanel } from './voice/VoicePanel'

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

        <div className="chgroup__head">
          <div className="side__label">
            <span>Личные сообщения</span>
          </div>
          <button className="chgroup__add" onClick={() => ui.openGroupModal({ mode: 'create' })} data-tip="Создать группу" aria-label="Создать группу">
            <Plus size={15} />
          </button>
        </div>

        {sorted.length === 0 && <p className="side__empty">Здесь появятся переписки и группы. Открой друга и нажми «Написать» ✦</p>}
        {sorted.map((d, i) => (
          <DmRow key={d.id} dm={d} active={view.kind === 'dm' && view.dmId === d.id} index={i} />
        ))}
      </div>

      <VoicePanel />
      <UserBar onLogout={onLogout} />
    </aside>
  )
}

function DmRow({ dm, active, index }: { dm: DmRef; active: boolean; index: number }) {
  const title = useChat((s) => dmTitle(s, dm))
  const user = useChat((s) => (dm.userId ? s.users[dm.userId] : undefined))
  const status = useChat((s) => (dm.userId ? presenceOf(s, dm.userId) : 'offline'))
  const unread = useChat((s) => s.unread[dm.id] ?? 0)
  const typingName = useChat((s) => {
    const who = Object.keys(s.typing[dm.id] ?? {})[0]
    return who ? (s.users[who]?.displayName ?? '…') : null
  })
  const inCall = useVoice((s) => (s.rooms[dm.id]?.length ?? 0) > 0)

  const sub = typingName
    ? dm.kind === 'group'
      ? `${typingName} печатает…`
      : 'печатает…'
    : dm.kind === 'group'
      ? `${dm.memberIds.length} участников`
      : user
        ? user.customStatus || STATUS_LABEL[status]
        : ''

  return (
    <button
      className={`dm-row${active ? ' is-active' : ''}${unread ? ' has-unread' : ''}`}
      style={{ animationDelay: `${index * 40}ms` }}
      onClick={() => chat.setView({ kind: 'dm', dmId: dm.id })}
    >
      {dm.kind === 'group' ? <GroupAvatar memberIds={dm.memberIds} size={34} /> : user && <Avatar user={user} size={34} status={status} />}
      <span className="dm-row__text">
        <span className="dm-row__name truncate">{title}</span>
        <span className={`dm-row__sub truncate${typingName ? ' is-typing' : ''}`}>{sub}</span>
      </span>
      {inCall && (
        <span className="dm-row__call" data-tip="Идёт звонок">
          <Phone size={13} />
        </span>
      )}
      {unread > 0 && <span className="count-badge">{unread}</span>}
    </button>
  )
}
