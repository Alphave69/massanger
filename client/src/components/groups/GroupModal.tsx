import { useMemo, useState, type FormEvent } from 'react'
import { Check, Search } from 'lucide-react'
import { api, ApiError, GROUP_LIMIT } from '../../lib/api'
import { chat, useChat } from '../../lib/store'
import { ui, useUi } from '../../lib/ui'
import { Avatar } from '../Avatar'
import { Modal } from '../Modal'

/** Создать группу или добавить в неё друзей — выбор из списка друзей */
export function GroupModal() {
  const modal = useUi((s) => s.groupModal)
  if (!modal) return null
  return <Picker key={modal.mode === 'add' ? modal.dmId : 'create'} dmId={modal.mode === 'add' ? modal.dmId : null} />
}

function Picker({ dmId }: { dmId: string | null }) {
  const friends = useChat((s) => s.friends)
  const users = useChat((s) => s.users)
  const group = useChat((s) => (dmId ? s.dms.find((d) => d.id === dmId) : undefined))
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const already = new Set(group?.memberIds ?? [])
  const room = GROUP_LIMIT - (group ? group.memberIds.length : 1)
  const candidates = useMemo(
    () =>
      friends
        .filter((f) => f.state === 'friends' && !already.has(f.userId))
        .map((f) => users[f.userId])
        .filter((u) => u !== undefined)
        .filter((u) => !query.trim() || `${u.displayName} ${u.username}`.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru')),
    [friends, users, query, group], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!picked.length || busy) return
    setBusy(true)
    setError(null)
    try {
      const { dm } = dmId ? await api.addToGroup(dmId, picked) : await api.createGroup(picked, name)
      chat.upsertDm(dm)
      chat.setView({ kind: 'dm', dmId: dm.id })
      ui.closeGroupModal()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Что-то пошло не так')
      setBusy(false)
    }
  }

  const action = dmId ? 'Добавить' : picked.length === 1 ? 'Открыть личку' : 'Создать группу'

  return (
    <Modal
      title={dmId ? 'Добавить друзей' : 'Новая группа'}
      subtitle={dmId ? `В группе может быть до ${GROUP_LIMIT} человек.` : `Выбери друзей — до ${GROUP_LIMIT - 1}. Позвонить можно будет всем сразу.`}
      onClose={ui.closeGroupModal}
    >
      <form className="picker" onSubmit={submit}>
        {!dmId && (
          <label className="modal__label">
            <span className="label">Название (можно потом)</span>
            <input className="input" value={name} maxLength={48} placeholder="Например, «Пятничный созвон»" onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <div className="picker__search">
          <Search size={16} />
          <input value={query} autoFocus placeholder="Найти друга" onChange={(e) => setQuery(e.target.value)} />
          <span className="picker__count">
            {picked.length}/{room}
          </span>
        </div>
        <div className="picker__list">
          {candidates.length === 0 && <p className="muted picker__empty">{friends.some((f) => f.state === 'friends') ? 'Никого не нашли' : 'Сначала добавь друзей'}</p>}
          {candidates.map((u) => {
            const on = picked.includes(u.id)
            return (
              <button type="button" key={u.id} className={`picker__item${on ? ' is-on' : ''}`} onClick={() => toggle(u.id)}>
                <Avatar user={u} size={32} />
                <span className="picker__name">
                  <b className="truncate">{u.displayName}</b>
                  <span className="truncate">@{u.username}</span>
                </span>
                <span className="picker__check">{on && <Check size={14} />}</span>
              </button>
            )
          })}
        </div>
        {error && <div className="modal__error">{error}</div>}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={ui.closeGroupModal}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={!picked.length || busy}>
            {action}
          </button>
        </div>
      </form>
    </Modal>
  )
}
