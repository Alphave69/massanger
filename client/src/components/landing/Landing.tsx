import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowRight,
  Award,
  ChevronDown,
  Crown,
  Download,
  Flame,
  Globe,
  Headphones,
  MessagesSquare,
  MicOff,
  Monitor,
  MonitorUp,
  Moon,
  MousePointer2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Volume2,
} from 'lucide-react'
import { MiniSphere } from '../MiniSphere'
import { Link } from './Link'

/**
 * Лендинг: что такое Nuntius, для тех, кто зашёл на сайт впервые (и не вошёл).
 * Большая сфера — та же, что на фоне всего приложения (режим hero), поэтому при переходе ко входу она остаётся на месте.
 */
export function Landing() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const featuresRef = useRef<HTMLElement>(null)

  useEffect(() => {
    document.title = 'Nuntius — мессенджер для своих'
    return () => {
      document.title = 'Nuntius'
    }
  }, [])

  // Пока листаешь вниз, сфера на фоне плавно уходит вверх и гаснет — чтобы не мешать читать
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const root = document.documentElement
    let raf = 0
    const apply = () => {
      raf = 0
      const k = Math.min(1, el.scrollTop / Math.max(1, el.clientHeight))
      root.style.setProperty('--lp-scroll', k.toFixed(3))
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }
    apply()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      root.style.removeProperty('--lp-scroll')
    }
  }, [])

  // Блоки ниже первого экрана проявляются, когда до них долистали
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const items = el.querySelectorAll('.lp-reveal')
    if (typeof IntersectionObserver === 'undefined') {
      items.forEach((item) => item.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          io.unobserve(entry.target)
        }
      },
      { root: el, threshold: 0.12, rootMargin: '0px 0px -30px 0px' },
    )
    items.forEach((item) => io.observe(item))
    return () => io.disconnect()
  }, [])

  const toFeatures = () => {
    const box = scrollRef.current
    const target = featuresRef.current
    if (box && target) box.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' })
  }

  const year = new Date().getFullYear()

  return (
    <div className="lp" ref={scrollRef}>
      <header className="lp-nav">
        <button type="button" className="lp-brand" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <MiniSphere size={26} dots={64} />
          <span>Nuntius</span>
        </button>
        <nav className="lp-nav__links" aria-label="Меню">
          <button type="button" className="lp-nav__link lp-only-wide" onClick={toFeatures}>
            Возможности
          </button>
          <Link to="download" className="lp-nav__link">
            <Download size={16} />
            <span>Скачать</span>
          </Link>
          <Link to="login" className="btn btn--outline lp-nav__login">
            Войти
          </Link>
        </nav>
      </header>

      {/* ---------- первый экран ---------- */}
      <section className="lp-hero">
        <div className="lp-hero__content">
          <span className="lp-eyebrow lp-in" style={delay(0.15)}>
            <i className="lp-eyebrow__dot" />
            мессенджер для своих
          </span>
          <h1 className="lp-title lp-in" style={delay(0.25)}>
            Nuntius
          </h1>
          <p className="lp-tagline lp-in" style={delay(0.38)}>
            Пиши. Говори. Будь рядом.
          </p>
          <p className="lp-lead lp-in" style={delay(0.48)}>
            Чаты, голосовые каналы, звонки и&nbsp;демонстрация экрана — для своей компании, в одном спокойном чёрном окне.
          </p>
          <div className="lp-actions lp-in" style={delay(0.6)}>
            <Link to="login" className="btn btn--primary lp-btn">
              <span>Открыть Nuntius</span>
              <ArrowRight size={18} className="btn__arrow" />
            </Link>
            <Link to="download" className="btn btn--outline lp-btn">
              <Download size={18} />
              <span>Скачать</span>
            </Link>
          </div>
          <div className="lp-platforms lp-in" style={delay(0.72)}>
            <span>
              <Monitor size={14} /> Windows
            </span>
            <span>
              <Smartphone size={14} /> iPhone и Android
            </span>
            <span>
              <Globe size={14} /> браузер
            </span>
          </div>
        </div>

        <button type="button" className="lp-cue" onClick={toFeatures} aria-label="Листать к возможностям">
          <span>листай</span>
          <ChevronDown size={16} />
        </button>
      </section>

      {/* ---------- возможности ---------- */}
      <section className="lp-section" ref={featuresRef}>
        <div className="lp-head lp-reveal">
          <span className="lp-kicker">// возможности</span>
          <h2 className="lp-h2">Всё для общения&nbsp;— в&nbsp;одном месте</h2>
          <p className="lp-sub">Как в больших мессенджерах, только своё: без рекламы, чужих людей и лишнего шума.</p>
        </div>

        <div className="lp-grid">
          {FEATURES.map((f, i) => (
            <article key={f.title} className="lp-card glow lp-reveal" style={delay(0.06 * (i % 3))}>
              <div className="lp-card__viz" aria-hidden="true">
                {f.viz}
              </div>
              <div className="lp-card__body">
                <span className="lp-card__icon">{f.icon}</span>
                <h3 className="lp-card__title">{f.title}</h3>
                <p className="lp-card__text">{f.text}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- призыв ---------- */}
      <section className="lp-cta lp-reveal">
        <div className="lp-cta__sphere">
          <MiniSphere size={64} dots={150} />
        </div>
        <h2 className="lp-h2">Собери своих в&nbsp;Nuntius</h2>
        <p className="lp-sub">Регистрация — пара секунд. Создай сервер, отправь друзьям приглашение — и вы на связи.</p>
        <div className="lp-actions lp-actions--center">
          <Link to="login" className="btn btn--primary lp-btn">
            <span>Открыть Nuntius</span>
            <ArrowRight size={18} className="btn__arrow" />
          </Link>
          <Link to="download" className="btn btn--outline lp-btn">
            <Download size={18} />
            <span>Скачать приложение</span>
          </Link>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-foot__brand">
          <MiniSphere size={20} dots={50} />
          <span className="lp-foot__name">Nuntius</span>
          <span className="lp-foot__latin">«вестник» по-латыни</span>
        </div>
        <nav className="lp-foot__links" aria-label="Ссылки">
          <Link to="download">Скачать</Link>
          <Link to="login">Войти</Link>
        </nav>
        <span className="lp-foot__meta">© {year} Nuntius</span>
      </footer>
    </div>
  )
}

function delay(seconds: number): CSSProperties {
  return { '--d': `${seconds}s` } as CSSProperties
}

interface Feature {
  icon: ReactNode
  title: string
  text: string
  viz: ReactNode
}

const FEATURES: Feature[] = [
  {
    icon: <Headphones size={20} />,
    title: 'Голосовые каналы и звонки',
    text: 'Заходи в голосовой канал в один клик — друзья уже там. А если нужно лично, позвони прямо из переписки.',
    viz: <VoiceViz />,
  },
  {
    icon: <MonitorUp size={20} />,
    title: 'Видео и демонстрация экрана',
    text: 'Включай камеру или показывай свой экран: игру, код или смешное видео — все смотрят вместе.',
    viz: <ScreenViz />,
  },
  {
    icon: <ShieldCheck size={20} />,
    title: 'Серверы с ролями и правами',
    text: 'Свой сервер для компании: текстовые и голосовые каналы, приглашения, роли и тонкие права доступа.',
    viz: <RolesViz />,
  },
  {
    icon: <MessagesSquare size={20} />,
    title: 'Личные сообщения и группы',
    text: 'Переписывайся один на один или собери группу. Отвечай на сообщения, пересылай и ставь реакции.',
    viz: <ChatViz />,
  },
  {
    icon: <Sparkles size={20} />,
    title: 'Значки и пасхалки',
    text: 'Собирай значки за активность и ищи спрятанные пасхалки. Некоторые так просто не найти.',
    viz: <BadgesViz />,
  },
  {
    icon: <Monitor size={20} />,
    title: 'На всех устройствах',
    text: 'Приложение для Windows, значок на главном экране телефона или просто вкладка браузера.',
    viz: <DevicesViz />,
  },
]

// ---------- маленькие «живые» картинки в карточках (чистый CSS, без картинок) ----------

function VoiceViz() {
  return (
    <div className="lp-voice">
      <div className="lp-voice__chan">
        <Volume2 size={14} /> общий
        <span className="lp-voice__count">3</span>
      </div>
      <div className="lp-voice__row is-speaking">
        <span className="lp-ava">А</span>
        <span className="lp-voice__name">Аня</span>
        <span className="lp-eq">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="lp-voice__row">
        <span className="lp-ava lp-ava--dark">М</span>
        <span className="lp-voice__name">Макс</span>
        <MicOff size={13} className="lp-voice__muted" />
      </div>
      <div className="lp-voice__row">
        <span className="lp-ava lp-ava--dark">К</span>
        <span className="lp-voice__name">Кирилл</span>
      </div>
    </div>
  )
}

function ScreenViz() {
  return (
    <div className="lp-screen">
      <div className="lp-screen__bar">
        <i />
        <i />
        <i />
      </div>
      <div className="lp-screen__body">
        <span className="lp-screen__live">
          <i /> в эфире
        </span>
        <span className="lp-screen__line" style={{ width: '62%' }} />
        <span className="lp-screen__line" style={{ width: '44%' }} />
        <span className="lp-screen__line" style={{ width: '54%' }} />
        <MousePointer2 size={16} className="lp-screen__cursor" />
        <span className="lp-screen__cam">А</span>
      </div>
    </div>
  )
}

function RolesViz() {
  return (
    <div className="lp-roles">
      <div className="lp-roles__chips">
        <span className="lp-chip lp-chip--solid">
          <Crown size={12} /> Создатель
        </span>
        <span className="lp-chip">
          <i /> Модератор
        </span>
        <span className="lp-chip lp-chip--dashed">
          <i /> Друзья
        </span>
      </div>
      <div className="lp-perm">
        <span>Управлять каналами</span>
        <span className="lp-toggle is-on" />
      </div>
      <div className="lp-perm">
        <span>Камера и экран</span>
        <span className="lp-toggle is-on" />
      </div>
    </div>
  )
}

function ChatViz() {
  return (
    <div className="lp-chat">
      <div className="lp-bubble">го в войс?</div>
      <div className="lp-bubble lp-bubble--me">уже там, заходи</div>
      <div className="lp-react">
        <span>🔥 2</span>
        <span>👍 1</span>
      </div>
    </div>
  )
}

function BadgesViz() {
  return (
    <div className="lp-badges">
      <span className="lp-medal">
        <Award size={22} />
      </span>
      <span className="lp-medal">
        <Flame size={22} />
      </span>
      <span className="lp-medal">
        <Moon size={22} />
      </span>
      <span className="lp-medal lp-medal--secret">?</span>
    </div>
  )
}

function DevicesViz() {
  return (
    <div className="lp-devices">
      <span className="lp-device">
        <Monitor size={22} />
      </span>
      <span className="lp-devices__link" />
      <span className="lp-device lp-device--main">
        <Smartphone size={22} />
      </span>
      <span className="lp-devices__link" />
      <span className="lp-device">
        <Globe size={22} />
      </span>
    </div>
  )
}
