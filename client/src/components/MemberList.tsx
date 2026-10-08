import type { CSSProperties } from 'react'
import { Crown } from 'lucide-react'
import type { Guild, Role, User } from '../lib/api'
import { hoistedRoleOf, roleColor } from '../lib/perms'
import { STATUS_LABEL, isOnline } from '../lib/status'
import { presenceFrom, useChat } from '../lib/store'
import type { Presence } from '../lib/api'
import { ui } from '../lib/ui'
import { Avatar } from './Avatar'
import { UserTags } from './UserTags'

export function MemberList({ guildId }: { guildId: string }) {
  const guild = useChat((s) => s.guilds.find((g) => g.id === guildId))
  const presence = useChat((s) => s.presence)
  const me = useChat((s) => s.me!)
  if (!guild) return null

  const statusOf = (id: string) => presenceFrom(presence, me, id)
  const byName = (a: User, b: User) => a.displayName.localeCompare(b.displayName, 'ru')
  // Сначала те, кто в сети, потом по имени
  const byPresence = (a: User, b: User) => Number(isOnline(statusOf(b.id))) - Number(isOnline(statusOf(a.id))) || byName(a, b)

  // Роли «показывать отдельно» — своими группами (по высшей такой роли), остальные — как обычно: в сети / не в сети
  const hoisted = new Map<string, { role: Role; users: User[] }>()
  const rest: User[] = []
  for (const m of guild.members) {
    const role = hoistedRoleOf(guild, m.id)
    if (!role) {
      rest.push(m)
      continue
    }
    const group = hoisted.get(role.id) ?? { role, users: [] }
    group.users.push(m)
    hoisted.set(role.id, group)
  }
  const roleGroups = [...hoisted.values()].sort((a, b) => b.role.position - a.role.position)
  const on = rest.filter((m) => isOnline(statusOf(m.id))).sort(byName)
  const off = rest.filter((m) => !isOnline(statusOf(m.id))).sort(byName)

  let shown = 0
  const delay = (n: number) => {
    const start = shown
    shown += n
    return start
  }

  return (
    <aside className="aside panel glow">
      {roleGroups.map((g) => (
        <Group key={g.role.id} title={g.role.name} role={g.role} users={g.users.sort(byPresence)} guild={guild} statusOf={statusOf} offset={delay(g.users.length)} />
      ))}
      {on.length > 0 && <Group title="В сети" users={on} guild={guild} statusOf={statusOf} offset={delay(on.length)} />}
      {off.length > 0 && <Group title="Не в сети" users={off} guild={guild} statusOf={statusOf} offset={delay(off.length)} />}
    </aside>
  )
}

interface GroupProps {
  title: string
  role?: Role
  users: User[]
  guild: Guild
  statusOf: (id: string) => Presence
  /** Сколько строк уже показано выше — для «волны» появления */
  offset: number
}

function Group({ title, role, users, guild, statusOf, offset }: GroupProps) {
  return (
    <section className={`members__group${role ? ' members__group--role' : ''}`} style={role?.color ? ({ '--role': role.color } as CSSProperties) : undefined}>
      <div className="side__label">
        <span className="truncate">
          {title} — {users.length}
        </span>
      </div>
      {users.map((u, i) => {
        const status = statusOf(u.id)
        const color = roleColor(guild, u.id)
        return (
          <button
            key={u.id}
            className={`member${isOnline(status) ? '' : ' member--offline'}`}
            style={{ animationDelay: `${Math.min(offset + i, 30) * 30}ms` }}
            onClick={(e) => ui.showProfile(u.id, e.currentTarget)}
          >
            <Avatar user={u} size={34} status={status} />
            <span className="member__text">
              <span className="member__name">
                <span className="truncate" style={color ? { color } : undefined}>
                  {u.displayName}
                </span>
                <UserTags user={u} />
                {u.id === guild.ownerId && <Crown size={13} className="member__crown" aria-label="владелец" />}
              </span>
              {(u.customStatus || status !== 'online') && <span className="member__sub truncate">{u.customStatus || STATUS_LABEL[status]}</span>}
            </span>
          </button>
        )
      })}
    </section>
  )
}
