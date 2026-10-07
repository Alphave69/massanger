import { useState, type FormEvent } from 'react'
import { Check, KeyRound, LoaderCircle } from 'lucide-react'
import { api, ApiError, setToken, type Me } from '../../lib/api'
import { selfPresence } from '../../lib/status'
import { chat, useChat } from '../../lib/store'
import { ui } from '../../lib/ui'
import { Avatar } from '../Avatar'
import { Group, Row, SectionHead } from './controls'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

export function AccountSection() {
  const me = useChat((s) => s.me!)
  const [editing, setEditing] = useState<'displayName' | 'username' | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)

  return (
    <>
      <SectionHead title="Мой аккаунт" subtitle="Имя, логин и безопасность входа." />

      <div className="account-card glow">
        <div className="account-card__banner" />
        <div className="account-card__head">
          <span className="account-card__avatar">
            <Avatar user={me} size={84} status={selfPresence(me.status)} ring />
          </span>
          <div className="account-card__who">
            <div className="account-card__name">{me.displayName}</div>
            <div className="account-card__tag">@{me.username}</div>
          </div>
          <button className="btn btn--primary" onClick={() => ui.openSettings('profile')}>
            Редактировать профиль
          </button>
        </div>

        <div className="account-card__rows">
          {editing === 'displayName' ? (
            <InlineEdit field="displayName" label="Отображаемое имя" initial={me.displayName} maxLength={32} onDone={() => setEditing(null)} />
          ) : (
            <Row label="Отображаемое имя" value={me.displayName}>
              <button className="btn btn--outline btn--sm" onClick={() => setEditing('displayName')}>
                Изменить
              </button>
            </Row>
          )}
          {editing === 'username' ? (
            <InlineEdit
              field="username"
              label="Логин"
              hint="3–32 символа: латиница, цифры, _ и . — по нему тебя добавляют в друзья"
              initial={me.username}
              maxLength={32}
              onDone={() => setEditing(null)}
            />
          ) : (
            <Row label="Логин" value={`@${me.username}`}>
              <button className="btn btn--outline btn--sm" onClick={() => setEditing('username')}>
                Изменить
              </button>
            </Row>
          )}
          <Row label="Почта" value={<span className="muted">Не привязана — появится вместе со входом по почте</span>}>
            <button className="btn btn--outline btn--sm" disabled>
              Скоро
            </button>
          </Row>
        </div>
      </div>

      <Group title="Пароль и безопасность">
        {passwordOpen ? (
          <PasswordForm onDone={() => setPasswordOpen(false)} />
        ) : (
          <div className="set-actions">
            <button className="btn btn--primary" onClick={() => setPasswordOpen(true)}>
              <KeyRound size={16} /> Сменить пароль
            </button>
            <span className="muted">После смены на других устройствах нужно будет войти заново.</span>
          </div>
        )}
      </Group>
    </>
  )
}

interface InlineEditProps {
  field: 'displayName' | 'username'
  label: string
  hint?: string
  initial: string
  maxLength: number
  onDone: () => void
}

/** Поле, которое редактируется прямо в строке */
function InlineEdit({ field, label, hint, initial, maxLength, onDone }: InlineEditProps) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!v || busy) return
    if (v === initial) return onDone()
    setBusy(true)
    setError(null)
    try {
      chat.setMe((await api.updateMe({ [field]: v } as Partial<Pick<Me, typeof field>>)).user)
      chat.toast({ title: 'Сохранено', text: `${label}: ${field === 'username' ? '@' : ''}${v}` })
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form className="inline-edit" onSubmit={submit}>
      <span className="set-row__label">{label}</span>
      <div className="inline-edit__line">
        {field === 'username' && <span className="inline-edit__at">@</span>}
        <input className="input" value={value} maxLength={maxLength} autoFocus spellCheck={false} onChange={(e) => setValue(e.target.value)} />
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={!value.trim() || busy}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Сохранить
        </button>
      </div>
      {hint && !error && <span className="muted">{hint}</span>}
      {error && <span className="form-error">{error}</span>}
    </form>
  )
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (next.length < 6) return setError('Новый пароль должен быть не короче 6 символов')
    if (next !== repeat) return setError('Пароли не совпадают')
    setBusy(true)
    setError(null)
    try {
      const { token } = await api.changePassword(current, next)
      setToken(token) // этой вкладке — новый токен, остальные устройства вылетят
      chat.toast({ title: 'Пароль изменён', text: 'На других устройствах нужно войти заново' })
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form className="password-form" onSubmit={submit}>
      <label>
        <span className="set-row__label">Текущий пароль</span>
        <input className="input" type="password" autoComplete="current-password" value={current} autoFocus onChange={(e) => setCurrent(e.target.value)} />
      </label>
      <label>
        <span className="set-row__label">Новый пароль</span>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label>
        <span className="set-row__label">Повтори новый пароль</span>
        <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </label>
      {error && <span className="form-error">{error}</span>}
      <div className="set-actions">
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn btn--primary" disabled={!current || !next || !repeat || busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <KeyRound size={16} />} Сменить пароль
        </button>
      </div>
    </form>
  )
}
