import { Crown } from 'lucide-react'
import type { User } from '../lib/api'
import { STATUS_LABEL, isOnline } from '../lib/status'
import { presenceFrom, useChat } from '../lib/store'
import type { Presence } from '../lib/api'
import { ui } from '../lib/ui'
import { Avatar } from './Avatar'

export function MemberList({ guildId }: { guildId: string }) {
  const guild = useChat((s) => s.guilds.find((g) => g.id === guildId))
  const presence = useChat((s) => s.presence)
  const me = useChat((s) => s.me!)
  if (!guild) return null

  const statusOf = (id: string) => presenceFrom(presence, me, id)
  const byName = (a: User, b: User) => a.displayName.localeCompare(b.displayName, 'ru')
  const on = guild.members.filter((m) => isOnline(statusOf(m.id))).sort(byName)
  const off = guild.members.filter((m) => !isOnline(statusOf(m.id))).sort(byName)

  return (
    <aside className="aside panel glow">
      <Group title="В сети" users={on} ownerId={guild.ownerId} statusOf={statusOf} />
      {off.length > 0 && <Group title="Не в сети" users={off} ownerId={guild.ownerId} statusOf={statusOf} />}
    </aside>
  )
}

interface GroupProps {
  title: string
  users: User[]
  ownerId: string
  statusOf: (id: string) => Presence
}

function Group({ title, users, ownerId, statusOf }: GroupProps) {
  return (
    <section className="members__group">
      <div className="side__label">
        <span>
          {title} — {users.length}
        </span>
      </div>
      {users.map((u, i) => {
        const status = statusOf(u.id)
        return (
          <button
            key={u.id}
            className={`member${isOnline(status) ? '' : ' member--offline'}`}
            style={{ animationDelay: `${i * 30}ms` }}
            onClick={(e) => ui.showProfile(u.id, e.currentTarget)}
          >
            <Avatar user={u} size={34} status={status} />
            <span className="member__text">
              <span className="member__name truncate">
                {u.displayName}
                {u.id === ownerId && <Crown size={13} className="member__crown" aria-label="владелец" />}
              </span>
              {(u.customStatus || status !== 'online') && <span className="member__sub truncate">{u.customStatus || STATUS_LABEL[status]}</span>}
            </span>
          </button>
        )
      })}
    </section>
  )
}
