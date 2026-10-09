import { useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, LoaderCircle, MailCheck } from 'lucide-react'
import { api, ApiError, type Me } from '../lib/api'
import { isMobile } from '../lib/mobile'
import { MiniSphere } from './MiniSphere'
import { CodeInput, useCountdown } from './CodeInput'

interface Props {
  onAuth: (token: string, user: Me) => void
  leaving: boolean
}

type Mode = 'login' | 'register'
/** form — обычная форма; verify — код после регистрации; forgot/reset — восстановление пароля */
type Step = 'form' | 'verify' | 'forgot' | 'reset'

export function AuthPage({ onAuth, leaving }: Props) {
  const [mode, setMode] = useState<Mode>('register')
  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [login, setLogin] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useCountdown()
  const formRef = useRef<HTMLFormElement>(null)

  const fail = (err: unknown) => {
    setError(err instanceof ApiError ? err.message : 'Что-то пошло не так')
    setBusy(false)
    // перезапускаем анимацию «тряски» карточки
    const form = formRef.current
    if (form) {
      form.classList.remove('auth-card--shake')
      void form.offsetWidth
      form.classList.add('auth-card--shake')
    }
  }

  /** Обёртка для запросов: занятость, сброс ошибки, «тряска» при ошибке */
  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      setBusy(false)
    } catch (err) {
      fail(err)
    }
  }

  const go = (next: Step) => {
    setStep(next)
    setError(null)
    setCode('')
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    go('form')
  }

  const sendRegistration = () =>
    run(async () => {
      const res = await api.register(email, login, displayName, password)
      setEmail(res.email)
      setResendIn(res.resendIn)
      if (step !== 'verify') go('verify')
    })

  const verifyRegistration = (value = code) =>
    run(async () => {
      const res = await api.verifyRegistration(email, value)
      onAuth(res.token, res.user)
    })

  const sendReset = () =>
    run(async () => {
      const res = await api.requestReset(email)
      setEmail(res.email)
      setResendIn(res.resendIn)
      if (step !== 'reset') go('reset')
    })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (step === 'verify') return void verifyRegistration()
    if (step === 'forgot') return void sendReset()
    if (step === 'reset') {
      return void run(async () => {
        const res = await api.finishReset(email, code, newPassword)
        onAuth(res.token, res.user)
      })
    }
    if (mode === 'register') return void sendRegistration()
    void run(async () => {
      const res = await api.login(login, password)
      onAuth(res.token, res.user)
    })
  }

  const title = {
    form: mode === 'register' ? 'Создай аккаунт' : 'С возвращением',
    verify: 'Проверь почту',
    forgot: 'Забыл пароль?',
    reset: 'Новый пароль',
  }[step]

  const subtitle = {
    form: mode === 'register' ? 'Пара секунд — и ты в чате с друзьями.' : 'Рады видеть тебя снова.',
    verify: (
      <>
        Мы отправили 6-значный код на <b>{email}</b>. Введи его ниже — письмо идёт до минуты, загляни и в «Спам».
      </>
    ),
    forgot: 'Введи почту, привязанную к аккаунту, — пришлём код для нового пароля.',
    reset: (
      <>
        Если <b>{email}</b> привязана к аккаунту, код уже в почте. Введи его и придумай новый пароль.
      </>
    ),
  }[step]

  const submitLabel = {
    form: mode === 'register' ? 'Зарегистрироваться' : 'Войти',
    verify: 'Подтвердить',
    forgot: 'Отправить код',
    reset: 'Сменить пароль и войти',
  }[step]

  const submitDisabled =
    busy ||
    (step === 'verify' && code.length < 6) ||
    (step === 'reset' && (code.length < 6 || newPassword.length < 6)) ||
    (step === 'forgot' && !email.trim())

  return (
    <div className={`auth${leaving ? ' auth--leaving' : ''}`}>
      <div className="auth__tagline" aria-hidden="true">
        <span className="auth__tagline-meta">// nuntius · v0.4</span>
      </div>

      <main className="auth__panel">
        <form ref={formRef} className="auth-card glow" onSubmit={submit} noValidate>
          <div className="auth-card__brand">
            <MiniSphere size={34} dots={70} />
            <span className="auth-card__wordmark">Nuntius</span>
          </div>

          {step === 'form' ? (
            <div className="auth-tabs" role="tablist">
              <span className="auth-tabs__thumb" style={{ transform: `translateX(${mode === 'login' ? 0 : 100}%)` }} />
              <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => switchMode('login')}>
                Вход
              </button>
              <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => switchMode('register')}>
                Регистрация
              </button>
            </div>
          ) : (
            <button type="button" className="auth-back" onClick={() => go('form')}>
              <ArrowLeft size={16} /> {step === 'verify' ? 'Изменить данные' : 'Назад ко входу'}
            </button>
          )}

          <h1 className="auth-card__title" key={`${mode}-${step}`}>
            {step === 'verify' && <MailCheck size={24} className="auth-card__title-icon" />}
            {title}
          </h1>
          <p className="auth-card__subtitle">{subtitle}</p>

          {step === 'form' && (
            <>
              <div className={`auth-card__collapsible${mode === 'register' ? ' is-open' : ''}`}>
                <div>
                  <Field label="Почта" type="email" value={email} onChange={setEmail} autoComplete="email" tabIndex={mode === 'register' ? 0 : -1} />
                </div>
              </div>
              <Field
                label={mode === 'login' ? 'Логин или почта' : 'Логин'}
                value={login}
                onChange={setLogin}
                autoComplete="username"
                // на телефоне клавиатура сразу закрыла бы полэкрана — пусть сначала увидят страницу
                autoFocus={!isMobile()}
              />
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
              {mode === 'login' && (
                <button
                  type="button"
                  className="auth-forgot"
                  onClick={() => {
                    if (login.includes('@')) setEmail(login.trim())
                    go('forgot')
                  }}
                >
                  Забыл пароль?
                </button>
              )}
            </>
          )}

          {step === 'verify' && (
            <CodeInput value={code} onChange={setCode} onComplete={(v) => void verifyRegistration(v)} autoFocus disabled={busy} />
          )}

          {step === 'forgot' && <Field label="Почта" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />}

          {step === 'reset' && (
            <>
              <CodeInput value={code} onChange={setCode} autoFocus disabled={busy} />
              <Field label="Новый пароль" type="password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
            </>
          )}

          {(step === 'verify' || step === 'reset') && (
            <button
              type="button"
              className="auth-resend"
              disabled={resendIn > 0 || busy}
              onClick={() => void (step === 'verify' ? sendRegistration() : sendReset())}
            >
              {resendIn > 0 ? `Отправить код ещё раз — через ${resendIn} с` : 'Отправить код ещё раз'}
            </button>
          )}

          <div className={`auth-card__error${error ? ' is-visible' : ''}`} role="alert">
            {error}
          </div>

          <button className="btn btn--primary auth-card__submit" type="submit" disabled={submitDisabled}>
            <span>{submitLabel}</span>
            {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} className="btn__arrow" />}
          </button>

          {step === 'form' && (
            <p className="auth-card__switch">
              {mode === 'register' ? 'Уже есть аккаунт? ' : 'Ещё нет аккаунта? '}
              <button type="button" onClick={() => switchMode(mode === 'register' ? 'login' : 'register')}>
                {mode === 'register' ? 'Войти' : 'Зарегистрироваться'}
              </button>
            </p>
          )}
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
    <label className="field">
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
