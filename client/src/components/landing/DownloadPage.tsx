import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  Copy,
  Download,
  EllipsisVertical,
  Globe,
  Monitor,
  Package,
  Share,
  ShieldAlert,
  Smartphone,
  SquarePlus,
} from 'lucide-react'
import { promptInstall, useInstall } from '../../lib/install'
import { detectOs, isIosSafari, isIpad, isPhoneOs, type Os } from '../../lib/platform'
import { MiniSphere } from '../MiniSphere'
import { Link } from './Link'

const RELEASE = 'https://github.com/Alphave69/massanger/releases/download/desktop-latest'
const SETUP_URL = `${RELEASE}/Nuntius-Setup.exe`
const PORTABLE_URL = `${RELEASE}/Nuntius-Portable.exe`

type PhoneTab = 'ios' | 'android'

interface Props {
  /** Вошёл в аккаунт — «назад» ведёт в приложение, а не на главную */
  signedIn: boolean
}

/** Страница «Скачать»: приложение для Windows и установка на телефон */
export function DownloadPage({ signedIn }: Props) {
  const os = useMemo(detectOs, [])
  const phoneFirst = isPhoneOs(os)

  useEffect(() => {
    // заголовок вкладки был с числом непрочитанных — вернём его как было
    const prev = document.title
    const own = 'Скачать Nuntius'
    document.title = own
    return () => {
      if (document.title === own) document.title = prev
    }
  }, [])

  const computer = <ComputerCard key="pc" os={os} recommended={!phoneFirst} />
  const phone = <PhoneCard key="phone" os={os} recommended={phoneFirst} />

  return (
    <div className="dl">
      <header className="dl-nav">
        <Link to="home" back className="dl-back">
          <ArrowLeft size={16} />
          <span>{signedIn ? 'Вернуться в Nuntius' : 'На главную'}</span>
        </Link>
        <Link to="home" back className="lp-brand" aria-label="Nuntius — на главную">
          <MiniSphere size={24} dots={60} />
          <span>Nuntius</span>
        </Link>
      </header>

      <main className="dl-main">
        <div className="dl-head">
          <span className="lp-kicker lp-in" style={delay(0.05)}>
            // скачать
          </span>
          <h1 className="dl-title lp-in" style={delay(0.12)}>
            Nuntius всегда под рукой
          </h1>
          <p className="lp-sub lp-in" style={delay(0.2)}>
            Приложение для компьютера или значок на главном экране телефона — выбирай, где удобнее.
          </p>
        </div>

        <div className="dl-grid">{phoneFirst ? [phone, computer] : [computer, phone]}</div>

        <Link to={signedIn ? 'home' : 'login'} back className="dl-browser lp-in" style={delay(0.5)}>
          <Globe size={16} />
          <span>{signedIn ? 'Продолжить в браузере' : 'Открыть в браузере'}</span>
          <ArrowRight size={16} className="dl-browser__arrow" />
        </Link>
      </main>
    </div>
  )
}

function delay(seconds: number): CSSProperties {
  return { '--d': `${seconds}s` } as CSSProperties
}

interface CardProps {
  os: Os
  recommended: boolean
}

function CardShell({ recommended, icon, title, meta, children, order }: { recommended: boolean; icon: ReactNode; title: string; meta: string; children: ReactNode; order: number }) {
  return (
    <section className={`dl-card glow lp-in${recommended ? ' is-recommended' : ''}`} style={delay(0.25 + order * 0.1)}>
      {recommended && <span className="dl-card__tag">Для этого устройства</span>}
      <div className="dl-card__head">
        <span className="dl-card__icon">{icon}</span>
        <div>
          <h2 className="dl-card__title">{title}</h2>
          <span className="dl-card__meta">{meta}</span>
        </div>
      </div>
      {children}
    </section>
  )
}

function ComputerCard({ os, recommended }: CardProps) {
  const canPrompt = useInstall((s) => s.canPrompt)
  const notWindows = os === 'mac' || os === 'linux'
  // На Mac и Linux Chrome/Edge умеют поставить сайт отдельным окном — это лучше, чем .exe, который там не запустится
  const browserInstall = notWindows && canPrompt
  return (
    <CardShell recommended={recommended} order={recommended ? 0 : 1} icon={<Monitor size={26} />} title="Для компьютера" meta="Windows 10 и 11">
      {notWindows && (
        <p className="dl-plain">
          Пока есть только версия для Windows. На {os === 'mac' ? 'Mac' : 'Linux'} Nuntius отлично работает прямо в браузере
          {browserInstall ? ' — а ещё его можно поставить отдельным окном.' : '.'}
        </p>
      )}
      {browserInstall && (
        <button type="button" className="btn btn--primary dl-cta" onClick={() => void promptInstall()}>
          <Download size={18} />
          <span>Установить из браузера</span>
        </button>
      )}

      <ul className="dl-perks">
        <li>
          <Check size={15} /> Своё окно — без вкладок и браузера
        </li>
        <li>
          <Check size={15} /> Уведомления, звонки и демонстрация экрана
        </li>
        <li>
          <Check size={15} /> Обновляется само — ничего не нужно переустанавливать
        </li>
      </ul>

      <a className={`btn ${browserInstall ? 'btn--outline' : 'btn--primary'} dl-cta`} href={SETUP_URL} download>
        <Download size={18} />
        <span>Скачать для Windows</span>
      </a>
      <a className="dl-alt" href={PORTABLE_URL} download>
        <Package size={14} />
        <span>Портативная версия</span>
        <span className="dl-alt__hint">— без установки, один файл</span>
      </a>

      <div className="dl-note">
        <ShieldAlert size={18} className="dl-note__icon" />
        <p>
          Windows может показать синее окно <b>«Система Windows защитила ваш компьютер»</b> — так бывает с новыми программами. Нажми{' '}
          <b>«Подробнее»</b> → <b>«Выполнить в любом случае»</b>.
        </p>
      </div>
    </CardShell>
  )
}

function PhoneCard({ os, recommended }: CardProps) {
  const canPrompt = useInstall((s) => s.canPrompt)
  const onPhone = isPhoneOs(os)
  // «Уже установлено» — только про сам телефон; на компьютере эта карточка про другое устройство
  const installed = useInstall((s) => s.installed) && onPhone
  const [tab, setTab] = useState<PhoneTab>(os === 'android' ? 'android' : 'ios')
  const [busy, setBusy] = useState(false)

  const install = async () => {
    setBusy(true)
    await promptInstall()
    setBusy(false)
  }

  return (
    <CardShell recommended={recommended} order={recommended ? 0 : 1} icon={<Smartphone size={26} />} title="Для телефона" meta="iPhone и Android">
      {installed ? (
        <div className="dl-done">
          <CircleCheck size={30} />
          <div>
            <b>Nuntius уже установлен</b>
            <p>Открывай его значком на главном экране — он запускается на весь экран, без браузера.</p>
          </div>
        </div>
      ) : (
        <>
          <ul className="dl-perks">
            <li>
              <Check size={15} /> Значок на главном экране, как у обычного приложения
            </li>
            <li>
              <Check size={15} /> Открывается на весь экран, без строки адреса
            </li>
            <li>
              <Check size={15} /> Без магазина приложений и лишних разрешений
            </li>
          </ul>

          {/* На телефоне показываем только его систему, на компьютере — обе вкладки */}
          {!onPhone && (
            <div className="dl-tabs" role="tablist" aria-label="Телефон">
              <span className="dl-tabs__thumb" style={{ transform: `translateX(${tab === 'ios' ? 0 : 100}%)` }} />
              <button type="button" role="tab" aria-selected={tab === 'ios'} onClick={() => setTab('ios')}>
                iPhone и iPad
              </button>
              <button type="button" role="tab" aria-selected={tab === 'android'} onClick={() => setTab('android')}>
                Android
              </button>
            </div>
          )}

          {tab === 'android' && os === 'android' && canPrompt ? (
            <>
              <button type="button" className="btn btn--primary dl-cta" onClick={() => void install()} disabled={busy}>
                <Download size={18} />
                <span>Установить</span>
              </button>
              <p className="dl-small">Телефон спросит подтверждение — и значок Nuntius появится среди приложений.</p>
            </>
          ) : tab === 'android' ? (
            <Steps
              steps={[
                ...(onPhone ? [] : [<>Открой <b>{location.host}</b> в Chrome на телефоне</>]),
                <>
                  Нажми меню браузера <Glyph><EllipsisVertical size={15} /></Glyph> в правом верхнем углу
                </>,
                <>
                  Выбери <b>«Установить приложение»</b> или <b>«Добавить на гл. экран»</b>
                </>,
                <>Подтверди — значок Nuntius появится на главном экране</>,
              ]}
            />
          ) : (
            <Steps
              steps={[
                ...(onPhone && isIosSafari() ? [] : [<>Открой <b>{location.host}</b> в Safari{onPhone ? '' : ' на iPhone или iPad'}</>]),
                <>
                  Нажми <b>«Поделиться»</b> <Glyph><Share size={15} /></Glyph>{' '}
                  {!onPhone ? 'внизу экрана (на iPad — сверху)' : isIpad() ? 'вверху экрана' : 'внизу экрана'}
                  <span className="dl-steps__hint">Не видно? Сначала нажми «•••» рядом с адресом</span>
                </>,
                <>
                  Пролистай и выбери <b>«На экран „Домой“»</b> <Glyph><SquarePlus size={15} /></Glyph>
                </>,
                <>
                  Нажми <b>«Добавить»</b> — готово
                </>,
              ]}
            />
          )}

          {!onPhone && <CopyLink />}
        </>
      )}
    </CardShell>
  )
}

function Steps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="dl-steps">
      {steps.map((step, i) => (
        <li key={i}>
          <span className="dl-steps__n">{i + 1}</span>
          <span className="dl-steps__text">{step}</span>
        </li>
      ))}
    </ol>
  )
}

function Glyph({ children }: { children: ReactNode }) {
  return <span className="dl-glyph">{children}</span>
}

/** На компьютере — ссылка, которую удобно отправить себе на телефон */
function CopyLink() {
  const url = `${location.host}/download`
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(t)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.protocol}//${url}`)
      setCopied(true)
    } catch {
      // без доступа к буферу — ссылку видно и так, можно выделить вручную
    }
  }

  return (
    <div className="dl-link">
      <span className="dl-link__label">Отправь себе ссылку</span>
      <div className="dl-link__row">
        <span className="dl-link__url">{url}</span>
        <button type="button" className={`dl-link__copy${copied ? ' is-done' : ''}`} onClick={() => void copy()}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          <span>{copied ? 'Скопировано' : 'Копировать'}</span>
        </button>
      </div>
    </div>
  )
}
