import { useState, type FormEvent } from 'react'
import { Check, KeyRound, LoaderCircle } from 'lucide-react'
import { api, ApiError, setToken, type Me } from '../../lib/api'
import { selfPresence } from '../../lib/status'
import { chat, useChat } from '../../lib/store'
import { ui } from '../../lib/ui'
import { Avatar } from '../Avatar'
import { CodeInput, useCountdown } from '../CodeInput'
import { Group, Row, SectionHead } from './controls'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

export function AccountSection() {
  const me = useChat((s) => s.me!)
  const [editing, setEditing] = useState<'displayName' | 'username' | 'email' | null>(null)
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
          {editing === 'email' ? (
            <EmailBind onDone={() => setEditing(null)} />
          ) : (
            <Row label="Почта" value={me.email ?? <span className="muted">Не привязана — нужна, чтобы входить по почте и восстановить пароль</span>}>
              <button className={`btn btn--sm ${me.email ? 'btn--outline' : 'btn--primary'}`} onClick={() => setEditing('email')}>
                {me.email ? 'Изменить' : 'Привязать'}
              </button>
            </Row>
          )}
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
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const needsPassword = field === 'username'
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!v || busy) return
    if (v === initial) return onDone()
    if (needsPassword && !password) return setError('Введи текущий пароль — без него логин не сменить')
    setBusy(true)
    setError(null)
    try {
      const patch = { [field]: v, ...(needsPassword ? { password } : {}) } as Partial<Pick<Me, typeof field>> & { password?: string }
      chat.setMe((await api.updateMe(patch)).user)
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
      {needsPassword && (
        <input
          className="input inline-edit__password"
          type="password"
          autoComplete="current-password"
          placeholder="Текущий пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      )}
      {hint && !error && <span className="muted">{hint}</span>}
      {error && <span className="form-error">{error}</span>}
    </form>
  )
}

/** Привязать или сменить почту: адрес + пароль → код из письма */
function EmailBind({ onDone }: { onDone: () => void }) {
  const me = useChat((s) => s.me!)
  const [stage, setStage] = useState<'form' | 'code'>('form')
  const [email, setEmail] = useState(me.email ?? '')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useCountdown()

  const send = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.startEmailBind(email.trim(), password)
      setResendIn(res.resendIn)
      setStage('code')
      setCode('')
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }

  const verify = async (value = code) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.verifyEmailBind(value)
      chat.setMe(user)
      chat.toast({ title: 'Почта привязана', text: `Теперь можно входить через ${user.email}` })
      onDone()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form
      className="inline-edit"
      onSubmit={(e) => {
        e.preventDefault()
        void (stage === 'form' ? send() : verify())
      }}
    >
      <span className="set-row__label">Почта</span>
      {stage === 'form' ? (
        <>
          <div className="inline-edit__line">
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="адрес@почта.ру"
              value={email}
              autoFocus
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="inline-edit__line">
            <input
              className="input inline-edit__password"
              type="password"
              autoComplete="current-password"
              placeholder="Текущий пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>
              Отмена
            </button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={!email.trim() || !password || busy}>
              {busy ? <LoaderCircle size={15} className="spin" /> : null} Отправить код
            </button>
          </div>
          <span className="muted">На новый адрес придёт письмо с кодом — так проверим, что почта твоя.</span>
        </>
      ) : (
        <>
          <span className="muted">
            Код отправлен на <b>{email.trim()}</b>. Письмо идёт до минуты — загляни и в «Спам».
          </span>
          <CodeInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} autoFocus disabled={busy} />
          <div className="inline-edit__line">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setStage('form')}>
              Изменить адрес
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={resendIn > 0 || busy} onClick={() => void send()}>
              {resendIn > 0 ? `Ещё раз через ${resendIn} с` : 'Отправить ещё раз'}
            </button>
            <button type="submit" className="btn btn--primary btn--sm" disabled={code.length < 6 || busy}>
              {busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Подтвердить
            </button>
          </div>
        </>
      )}
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
