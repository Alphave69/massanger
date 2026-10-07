import { useState } from 'react'
import { Crown, LogOut, Pencil, UserPlus, X } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { STATUS_LABEL } from '../../lib/status'
import { chat, dmTitle, presenceOf, useChat, type DmRef } from '../../lib/store'
import { ui } from '../../lib/ui'
import { Avatar } from '../Avatar'
import { GroupAvatar } from './GroupAvatar'
import { MEMBERS, plural } from '../../lib/format'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

/** Правая колонка группы: название, участники, добавить, выйти */
export function GroupAside({ dm }: { dm: DmRef }) {
  const title = useChat((s) => dmTitle(s, dm))
  const meId = useChat((s) => s.me!.id)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(dm.name)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const isOwner = dm.ownerId === meId

  const rename = async () => {
    setEditing(false)
    if (name.trim() === dm.name) return
    try {
      chat.upsertDm((await api.renameGroup(dm.id, name.trim())).dm)
    } catch (err) {
      chat.toast({ title: 'Не переименовалось', text: errorText(err) })
    }
  }

  const leave = async () => {
    if (!confirmLeave) return setConfirmLeave(true)
    try {
      await api.leaveGroup(dm.id)
      chat.removeDm(dm.id)
    } catch (err) {
      chat.toast({ title: 'Не получилось выйти', text: errorText(err) })
    }
  }

  return (
    <aside className="aside panel glow aside--group">
      <div className="group-head">
        <GroupAvatar memberIds={dm.memberIds} size={64} />
        {editing ? (
          <input
            className="input group-head__input"
            value={name}
            autoFocus
            maxLength={48}
            placeholder="Название группы"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        ) : (
          <button
            className="group-head__name"
            onClick={() => {
              setName(dm.name)
              setEditing(true)
            }}
            data-tip="Переименовать"
          >
            <span className="truncate">{title}</span>
            <Pencil size={13} />
          </button>
        )}
        <span className="group-head__meta">{plural(dm.memberIds.length, MEMBERS)}</span>
        <div className="group-head__actions">
          <button className="btn btn--outline btn--sm" onClick={() => ui.openGroupModal({ mode: 'add', dmId: dm.id })}>
            <UserPlus size={15} /> Добавить
          </button>
          <button className={`btn btn--sm ${confirmLeave ? 'btn--primary' : 'btn--ghost'}`} onClick={() => void leave()} onBlur={() => setConfirmLeave(false)}>
            <LogOut size={15} /> {confirmLeave ? 'Точно выйти?' : 'Выйти'}
          </button>
        </div>
      </div>

      <div className="side__label">
        <span>Участники — {dm.memberIds.length}</span>
      </div>
      {dm.memberIds.map((id) => (
        <GroupMember key={id} dm={dm} userId={id} canKick={isOwner && id !== meId} />
      ))}
    </aside>
  )
}

function GroupMember({ dm, userId, canKick }: { dm: DmRef; userId: string; canKick: boolean }) {
  const user = useChat((s) => s.users[userId])
  const status = useChat((s) => presenceOf(s, userId))
  if (!user) return null

  const kick = async () => {
    try {
      chat.upsertDm((await api.removeFromGroup(dm.id, userId)).dm)
    } catch (err) {
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
  }

  return (
    <div className={`member${status === 'offline' ? ' member--offline' : ''}`}>
      <button className="member__who" onClick={(e) => ui.showProfile(userId, e.currentTarget)}>
        <Avatar user={user} size={34} status={status} />
        <span className="member__text">
          <span className="member__name truncate">
            {user.displayName}
            {userId === dm.ownerId && <Crown size={13} className="member__crown" aria-label="создатель" />}
          </span>
          <span className="member__sub truncate">{user.customStatus || STATUS_LABEL[status]}</span>
        </span>
      </button>
      {canKick && (
        <button className="member__kick" onClick={() => void kick()} data-tip="Исключить" aria-label="Исключить">
          <X size={14} />
        </button>
      )}
    </div>
  )
}
