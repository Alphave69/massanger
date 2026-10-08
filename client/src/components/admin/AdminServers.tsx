import { useState } from 'react'
import { Globe, LoaderCircle, Search, Trash2, X } from 'lucide-react'
import { api, type AdminGuild, type AdminUser } from '../../lib/api'
import { initials, MEMBERS, plural } from '../../lib/format'
import { chat } from '../../lib/store'
import { errorText } from './bits'

interface Props {
  guilds: AdminGuild[]
  users: AdminUser[]
  onDeleted: (guildId: string) => void
}

/** «Серверы»: все серверы Nuntius; любой, кроме лобби, можно удалить (с подтверждением названием) */
export function AdminServers({ guilds, users, onDeleted }: Props) {
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const owners = new Map(users.map((u) => [u.id, u]))

  const q = query.trim().toLowerCase()
  const list = guilds
    .filter((g) => !q || g.name.toLowerCase().includes(q) || (owners.get(g.ownerId)?.displayName ?? '').toLowerCase().includes(q))
    .sort((a, b) => Number(b.isLobby) - Number(a.isLobby) || b.members - a.members)
  const biggest = Math.max(1, ...guilds.map((g) => g.members))

  return (
    <div className="adm-servers">
      {guilds.length > 6 && (
        <div className="adm-toolbar">
          <label className="adm-search">
            <Search size={15} />
            <input className="input" value={query} placeholder="Название сервера или владелец" onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      )}
      {list.length === 0 && <div className="adm-empty">{q ? 'Ничего не нашлось' : 'Серверов пока нет'}</div>}
      {list.map((g, i) => (
        <ServerRow
          key={g.id}
          guild={g}
          index={i}
          owner={owners.get(g.ownerId)}
          share={g.members / biggest}
          confirming={confirm === g.id}
          onConfirm={(v) => setConfirm(v ? g.id : null)}
          onDeleted={() => {
            setConfirm(null)
            onDeleted(g.id)
          }}
        />
      ))}
    </div>
  )
}

interface RowProps {
  guild: AdminGuild
  index: number
  owner?: AdminUser
  /** Доля от самого большого сервера — для полоски */
  share: number
  confirming: boolean
  onConfirm: (v: boolean) => void
  onDeleted: () => void
}

function ServerRow({ guild: g, index, owner, share, confirming, onConfirm, onDeleted }: RowProps) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const match = typed.trim() === g.name.trim()

  const remove = async () => {
    if (!match) return
    setBusy(true)
    try {
      await api.adminDeleteGuild(g.id)
      chat.toast({ title: `«${g.name}» удалён`, text: 'Участников уже предупредили' })
      onDeleted()
    } catch (err) {
      chat.toast({ title: 'Не получилось удалить', text: errorText(err) })
      setBusy(false)
    }
  }

  return (
    <div className={`adm-server${confirming ? ' is-confirming' : ''}`} style={{ animationDelay: `${Math.min(index, 14) * 35}ms` }}>
      <div className="adm-server__row">
        <span className={`adm-server__icon${g.isLobby ? ' is-lobby' : ''}`}>{g.isLobby ? <Globe size={18} /> : initials(g.name)}</span>
        <span className="adm-server__text">
          <span className="adm-server__name">
            <span className="truncate">{g.name}</span>
            {g.isLobby && <span className="adm-flag">лобби</span>}
          </span>
          <span className="adm-server__sub truncate">
            {plural(g.members, MEMBERS)} · владелец {owner ? owner.displayName : 'неизвестен'}
          </span>
          <span className="adm-server__bar">
            <span style={{ width: `${Math.max(2, share * 100)}%` }} />
          </span>
        </span>
        {g.isLobby ? (
          <span className="adm-server__lock" data-tip="Общий сервер нельзя удалить">
            навсегда
          </span>
        ) : (
          <button
            className={`icon-btn adm-server__del${confirming ? ' is-active' : ''}`}
            onClick={() => {
              setTyped('')
              onConfirm(!confirming)
            }}
            data-tip={confirming ? 'Отмена' : 'Удалить сервер'}
            aria-label={confirming ? 'Отмена' : 'Удалить сервер'}
          >
            {confirming ? <X size={16} /> : <Trash2 size={16} />}
          </button>
        )}
      </div>

      {confirming && (
        <div className="adm-server__confirm">
          <p>
            Сервер, его каналы и все сообщения исчезнут навсегда. Чтобы подтвердить, введи название: <b>{g.name}</b>
          </p>
          <div className="adm-server__confirm-line">
            <input
              className={`input${typed && !match ? ' is-wrong' : ''}`}
              value={typed}
              autoFocus
              placeholder={g.name}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void remove()
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  onConfirm(false)
                }
              }}
            />
            <button className="btn btn--primary btn--sm adm-danger" disabled={!match || busy} onClick={() => void remove()}>
              {busy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />} Удалить навсегда
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
