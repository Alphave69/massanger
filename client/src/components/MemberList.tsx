import type { User } from '../lib/api'
import { Avatar } from './Avatar'

interface Props {
  members: User[]
  online: Set<string>
  ownerId: string | undefined
}

export function MemberList({ members, online, ownerId }: Props) {
  const byName = (a: User, b: User) => a.displayName.localeCompare(b.displayName, 'ru')
  const on = members.filter((m) => online.has(m.id)).sort(byName)
  const off = members.filter((m) => !online.has(m.id)).sort(byName)

  return (
    <aside className="members">
      <MemberGroup title={`В сети — ${on.length}`} users={on} online ownerId={ownerId} />
      {off.length > 0 && <MemberGroup title={`Не в сети — ${off.length}`} users={off} online={false} ownerId={ownerId} />}
    </aside>
  )
}

function MemberGroup({ title, users, online, ownerId }: { title: string; users: User[]; online: boolean; ownerId: string | undefined }) {
  return (
    <section className="members__group">
      <h4>{title}</h4>
      {users.map((u, i) => (
        <div key={u.id} className={`member${online ? '' : ' member--offline'}`} style={{ animationDelay: `${i * 30}ms` }}>
          <Avatar user={u} size={32} status={online ? 'online' : 'offline'} />
          <span className="truncate">{u.displayName}</span>
          {u.id === ownerId && <span className="member__badge">админ</span>}
        </div>
      ))}
    </section>
  )
}
