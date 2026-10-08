import { useRef, useState } from 'react'
import { Crown, Plus, Search, UserMinus } from 'lucide-react'
import { api, ApiError, type Guild, type Role, type User } from '../../lib/api'
import { plural } from '../../lib/format'
import { can, canManageRole, highestPosition, isEveryone, outranks, roleColor, rolesOf } from '../../lib/perms'
import { chat, useChat } from '../../lib/store'
import { Avatar } from '../Avatar'
import { SectionHead } from '../settings/controls'
import { UserTags } from '../UserTags'
import { Popover } from './Popover'
import { RoleChip, RoleDot } from './RoleBits'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

const PAGE = 60

/** Раздел «Участники»: роли каждого человека (выдать / снять) и «выгнать» — по правам */
export function MembersSection({ guild }: { guild: Guild }) {
  const meId = useChat((s) => s.me?.id ?? '')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [confirm, setConfirm] = useState<string | null>(null)

  const kick = async (userId: string) => {
    if (confirm !== userId) return setConfirm(userId)
    try {
      chat.upsertGuild((await api.kickMember(guild.id, userId)).guild)
      setConfirm(null)
    } catch (err) {
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
  }

  const q = query.trim().toLowerCase()
  const members = guild.members
    .filter((m) => !q || m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
    .sort((a, b) => {
      // владелец, потом по старшинству ролей, потом по имени
      const pa = highestPosition(guild, a.id)
      const pb = highestPosition(guild, b.id)
      return pa !== pb ? pb - pa : a.displayName.localeCompare(b.displayName, 'ru')
    })
  const canKick = can(guild, 'KICK_MEMBERS')
  const canRoles = can(guild, 'MANAGE_ROLES')

  return (
    <>
      <SectionHead
        title="Участники"
        subtitle={`${plural(guild.members.length, ['человек', 'человека', 'человек'])} на сервере.${canRoles ? ' Нажми «+ роль», чтобы выдать роль.' : ''}`}
      />
      {guild.members.length > 8 && (
        <span className="search-field members-search">
          <Search size={15} />
          <input
            className="input"
            value={query}
            placeholder="Найти по имени или логину"
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
          />
        </span>
      )}
      <div className="ch-list">
        {members.length === 0 && <p className="muted">Никого не нашли.</p>}
        {members.slice(0, limit).map((m, i) => (
          <MemberRow
            key={m.id}
            guild={guild}
            user={m}
            index={i}
            isMe={m.id === meId}
            canKick={canKick && outranks(guild, m.id)}
            confirming={confirm === m.id}
            onKick={() => void kick(m.id)}
            onBlurKick={() => setConfirm(null)}
          />
        ))}
      </div>
      {members.length > limit && (
        <button className="btn btn--outline btn--sm ch-list__add" onClick={() => setLimit((l) => l + PAGE)}>
          Показать ещё {Math.min(PAGE, members.length - limit)}
        </button>
      )}
    </>
  )
}

interface RowProps {
  guild: Guild
  user: User
  index: number
  isMe: boolean
  canKick: boolean
  confirming: boolean
  onKick: () => void
  onBlurKick: () => void
}

function MemberRow({ guild, user, index, isMe, canKick, confirming, onKick, onBlurKick }: RowProps) {
  const [busy, setBusy] = useState(false)
  const roles = rolesOf(guild, user.id)
  const color = roleColor(guild, user.id)
  const assignable = (guild.roles ?? []).filter((r) => !isEveryone(guild, r) && canManageRole(guild, r) && !roles.some((x) => x.id === r.id))

  const setRoles = async (ids: string[]) => {
    setBusy(true)
    try {
      chat.upsertGuild((await api.setMemberRoles(guild.id, user.id, ids)).guild)
    } catch (err) {
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
    setBusy(false)
  }
  const current = guild.memberRoles?.[user.id] ?? []

  return (
    <div className="ch-item ch-item--member mrow" style={{ animationDelay: `${Math.min(index, 14) * 20}ms` }}>
      <Avatar user={user} size={34} />
      <div className="mrow__main">
        <span className="ch-item__who">
          <b className="truncate">
            <span className="mrow__name truncate" style={color ? { color } : undefined}>
              {user.displayName}
            </span>
            <UserTags user={user} />
            {user.id === guild.ownerId && <Crown size={13} className="member__crown" aria-label="владелец" />}
            {isMe && <span className="mrow__me">ты</span>}
          </b>
          <span className="truncate">@{user.username}</span>
        </span>
        {(roles.length > 0 || assignable.length > 0) && (
          <div className="mrow__roles">
            {roles.map((r) => (
              <RoleChip key={r.id} role={r} busy={busy} onRemove={canManageRole(guild, r) ? () => void setRoles(current.filter((id) => id !== r.id)) : undefined} />
            ))}
            {assignable.length > 0 && <AddRole name={user.displayName} roles={assignable} busy={busy} onPick={(id) => void setRoles([...current, id])} />}
          </div>
        )}
      </div>
      {canKick && (
        <button className={`btn btn--sm ${confirming ? 'btn--primary' : 'btn--ghost'}`} onClick={onKick} onBlur={onBlurKick}>
          <UserMinus size={15} /> {confirming ? 'Точно?' : 'Выгнать'}
        </button>
      )}
    </div>
  )
}

/** «+ роль»: меню ролей, которые можно выдать */
function AddRole({ name, roles, busy, onPick }: { name: string; roles: Role[]; busy: boolean; onPick: (roleId: string) => void }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={btnRef} className={`role-add${open ? ' is-open' : ''}`} onClick={() => setOpen((v) => !v)} disabled={busy} aria-expanded={open}>
        <Plus size={12} /> роль
      </button>
      {open && (
        <Popover anchorRef={btnRef} onClose={() => setOpen(false)} className="role-menu">
          <div className="role-menu__title">
            <span className="truncate">Роль для: {name}</span>
          </div>
          <div className="role-menu__list">
            {roles.map((r) => (
              <button
                key={r.id}
                className="role-menu__item"
                onClick={() => {
                  setOpen(false)
                  onPick(r.id)
                }}
              >
                <RoleDot color={r.color} />
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
