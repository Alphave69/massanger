import { useRef, useState, type FormEvent } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import { api, ApiError, type User } from '../lib/api'
import { ParticleSphere } from './ParticleSphere'
import { Logo } from './Logo'

interface Props {
  onAuth: (token: string, user: User) => void
}

type Mode = 'login' | 'register'

export function AuthPage({ onAuth }: Props) {
  const [mode, setMode] = useState<Mode>('register')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = mode === 'register' ? await api.register(username, displayName, password) : await api.login(username, password)
      // Даём странице красиво «уйти» перед входом
      setLeaving(true)
      setTimeout(() => onAuth(res.token, res.user), 450)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Что-то пошло не так')
      // перезапускаем анимацию «тряски» карточки
      const form = formRef.current
      if (form) {
        form.classList.remove('auth-card--shake')
        void form.offsetWidth
        form.classList.add('auth-card--shake')
      }
      setBusy(false)
    }
  }

  return (
    <div className={`auth${leaving ? ' auth--leaving' : ''}`}>
      <ParticleSphere className="auth__sphere" />
      <div className="auth__vignette" />

      <div className="auth__tagline">
        <span>твой сервер.</span>
        <span>твои люди.</span>
      </div>

      <main className="auth__panel">
        <form ref={formRef} className="auth-card" onSubmit={submit} noValidate>
          <div className="auth-card__brand">
            <Logo size={34} />
            <span className="auth-card__wordmark">Massanger</span>
          </div>

          <div className="auth-tabs" role="tablist">
            <span className="auth-tabs__thumb" style={{ transform: `translateX(${mode === 'login' ? 0 : 100}%)` }} />
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>
              Вход
            </button>
            <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')}>
              Регистрация
            </button>
          </div>

          <h1 className="auth-card__title" key={mode}>
            {mode === 'register' ? 'Создай аккаунт' : 'С возвращением'}
          </h1>
          <p className="auth-card__subtitle">
            {mode === 'register' ? 'Пара секунд — и ты в чате с друзьями.' : 'Рады видеть тебя снова.'}
          </p>

          <Field label="Логин" value={username} onChange={setUsername} autoComplete="username" autoFocus />
          <div className={`auth-card__collapsible${mode === 'register' ? ' is-open' : ''}`}>
            <div>
              <Field
                label="Отображаемое имя"
                value={displayName}
                onChange={setDisplayName}
                autoComplete="nickname"
                tabIndex={mode === 'register' ? 0 : -1}
              />
            </div>
          </div>
          <Field
            label="Пароль"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />

          <div className={`auth-card__error${error ? ' is-visible' : ''}`} role="alert">
            {error}
          </div>

          <button className="btn btn--primary auth-card__submit" type="submit" disabled={busy}>
            <span>{mode === 'register' ? 'Зарегистрироваться' : 'Войти'}</span>
            {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} className="btn__arrow" />}
          </button>

          <p className="auth-card__switch">
            {mode === 'register' ? 'Уже есть аккаунт? ' : 'Ещё нет аккаунта? '}
            <button type="button" onClick={() => switchMode(mode === 'register' ? 'login' : 'register')}>
              {mode === 'register' ? 'Войти' : 'Зарегистрироваться'}
            </button>
          </p>
        </form>
      </main>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoComplete?: string
  autoFocus?: boolean
  tabIndex?: number
}

function Field({ label, value, onChange, type = 'text', autoComplete, autoFocus, tabIndex }: FieldProps) {
  return (
    <label className={`field${value ? ' field--filled' : ''}`}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        spellCheck={false}
        placeholder=" "
      />
      <span className="field__label">{label}</span>
      <span className="field__line" />
    </label>
  )
}
