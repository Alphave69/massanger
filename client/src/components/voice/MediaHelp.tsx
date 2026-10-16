import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronDown, Lock, Mic, MonitorUp, RefreshCw, Settings2, X } from 'lucide-react'
import { closeMediaHelp, hideAsk, retryMediaHelp, useMediaHelp, type MediaHelpState, type MediaKind } from '../../lib/mediaHelp'
import { BROWSER_NAME, detectBrowser, detectMediaEnv, detectOs, type Browser, type MediaEnv, type Os } from '../../lib/platform'
import { useIsMobile } from '../../lib/mobile'
import { useSheetSwipe } from '../../lib/swipe'

/**
 * Помощь с разрешениями (логика — в lib/mediaHelp.ts):
 *  - пока браузер спрашивает доступ — плашка «нажми «Разрешить»» и картинка, где это окошко;
 *  - доступ запрещён — окно с инструкцией под этот браузер, телефон или приложение для Windows.
 */
export function MediaHelp() {
  const asking = useMediaHelp((s) => s.asking)
  const denied = useMediaHelp((s) => s.denied)
  if (!asking && !denied) return null
  return createPortal(
    <div className="zoomed media-help-layer">
      {asking && !denied && <AskHint kind={asking} />}
      {denied && <DeniedModal key={denied.seq} denied={denied} />}
    </div>,
    document.body,
  )
}

/** Склонения: «доступ к микрофону», «разреши камеру», «значок микрофона» */
const WORDS: Record<MediaKind, { nom: string; dat: string; acc: string; gen: string; icon: ReactNode }> = {
  mic: { nom: 'Микрофон', dat: 'микрофону', acc: 'микрофон', gen: 'микрофона', icon: <Mic size={14} /> },
  camera: { nom: 'Камера', dat: 'камере', acc: 'камеру', gen: 'камеры', icon: <Camera size={14} /> },
  screen: { nom: 'Экран', dat: 'экрану', acc: 'экран', gen: 'экрана', icon: <MonitorUp size={14} /> },
}

/** Где на экране появляется окошко браузера */
const PROMPT_WHERE: Record<MediaEnv, string> = {
  app: '',
  chromium: 'слева вверху, под адресом сайта',
  firefox: 'слева вверху, под адресом сайта',
  safari: 'под адресной строкой',
  android: 'внизу экрана',
  ios: 'посередине экрана',
  other: 'браузера',
}

const host = () => location.hostname || 'nuntius.site'

// ============ «Сейчас браузер спросит…» ============

function AskHint({ kind }: { kind: MediaKind }) {
  const env = detectMediaEnv()
  const w = WORDS[kind]
  // окошко Safari на Mac выпадает из адресной строки посередине — там наша плашка мешала бы, уводим её вниз
  const place = env === 'safari' ? 'bottom' : 'top'
  return (
    <div className={`media-ask media-ask--${place}`} role="status" aria-live="polite">
      <PromptPicture env={env} kind={kind} />
      <div className="media-ask__text">
        <b>{kind === 'screen' ? 'Выбери, что показать' : `Сейчас браузер спросит доступ к ${w.dat}`}</b>
        <span>
          {kind === 'screen' ? (
            <>
              Весь экран, окно или вкладку — и нажми <q>Поделиться</q>. Чтобы друзья слышали звук, включи <q>Поделиться звуком</q>.
            </>
          ) : (
            <>
              Нажми <q>Разрешить</q> в окошке {PROMPT_WHERE[env]}
              {env === 'chromium' || env === 'firefox' ? ' ↖' : ''}
            </>
          )}
        </span>
      </div>
      <button className="media-ask__close" onClick={hideAsk} aria-label="Скрыть подсказку">
        <X size={15} />
      </button>
    </div>
  )
}

/** Картинка: как выглядит окошко браузера и где в нём «Разрешить» */
function PromptPicture({ env, kind }: { env: MediaEnv; kind: MediaKind }) {
  const w = WORDS[kind]
  if (kind === 'screen') {
    return (
      <div className="mpic mpic--desk" aria-hidden="true">
        <BrowserBar />
        <div className="mpic__picker">
          <span className="mpic__tabs">
            <i>Вкладка</i>
            <i>Окно</i>
            <i className="is-on">Весь экран</i>
          </span>
          <span className="mpic__thumbs">
            <i className="is-on" />
            <i />
          </span>
          <span className="mpic__btns">
            <em>Отмена</em>
            <em className="is-go">Поделиться</em>
          </span>
        </div>
      </div>
    )
  }
  const phone = env === 'android' || env === 'ios'
  const question =
    env === 'ios' || env === 'safari' ? `Разрешить «${host()}» доступ к ${w.dat}?` : env === 'android' ? `Разрешить сайту доступ к ${w.dat}?` : `${host()} запрашивает разрешение`
  return (
    <div className={`mpic ${phone ? 'mpic--phone' : 'mpic--desk'} mpic--${env}`} aria-hidden="true">
      {!phone && <BrowserBar />}
      {phone && env === 'android' && <span className="mpic__url mpic__url--phone">{host()}</span>}
      <div className="mpic__prompt">
        <small>{question}</small>
        {!phone && env !== 'safari' && (
          <span className="mpic__ask">
            {w.icon} Использовать {w.acc}
          </span>
        )}
        <span className="mpic__btns">
          <em>{env === 'ios' || env === 'safari' ? 'Не разрешать' : 'Блокировать'}</em>
          <em className="is-go">Разрешить</em>
        </span>
      </div>
    </div>
  )
}

/** Верх окна браузера: кнопки окна и адрес сайта с замочком */
function BrowserBar({ lockOn }: { lockOn?: boolean }) {
  return (
    <span className="mpic__bar">
      <i />
      <i />
      <i />
      <span className="mpic__url">
        <span className={`mpic__lock${lockOn ? ' is-on' : ''}`}>
          <Lock size={9} strokeWidth={3} />
        </span>
        {host()}
      </span>
    </span>
  )
}

// ============ «Нет доступа» ============

interface Help {
  title: string
  lead: ReactNode
  steps: ReactNode[]
  extra?: ReactNode
}

/** Где в macOS и Windows включается доступ к устройству */
const MAC_PANE: Record<MediaKind, string> = { mic: 'Микрофон', camera: 'Камера', screen: 'Запись экрана и аудио (или «Запись экрана»)' }

function deviceHelp(kind: 'mic' | 'camera', env: MediaEnv, browser: Browser, os: Os): Help {
  const w = WORDS[kind]
  const name = BROWSER_NAME[browser]
  const title = `Нет доступа к ${w.dat}`
  const reload = 'Обнови страницу — или просто нажми «Проверить снова» ниже'
  const macExtra =
    os === 'mac' ? (
      <>
        В браузере уже «Разрешить», а {w.acc} всё равно не работает? Тогда не пускает macOS: Системные настройки → Конфиденциальность и безопасность → {MAC_PANE[kind]} → включи {name} и перезапусти его.
      </>
    ) : undefined
  const winExtra =
    os === 'windows' ? (
      <>
        В браузере уже разрешено, а {w.acc} не работает? Проверь Windows: Параметры → Конфиденциальность и защита → {w.nom} → «Разрешить приложениям доступ к {w.dat}».
      </>
    ) : undefined

  switch (env) {
    case 'app':
      return {
        title,
        lead: <>Приложение Nuntius разрешает себе {w.acc} само — значит, не пускает Windows. Это включается в параметрах Windows:</>,
        steps: [
          <>Открой Параметры Windows (клавиши Win + I) → «Конфиденциальность и защита»</>,
          <>
            Выбери «{w.nom}» и включи «Доступ к {w.dat}» и «Разрешить приложениям доступ к {w.dat}»
          </>,
          <>Ниже включи «Разрешить классическим приложениям доступ к {w.dat}»</>,
          <>Вернись сюда и нажми «Проверить снова»</>,
        ],
        extra: <>Всё включено, а толку нет? Иногда не пускает антивирус — например, у Kaspersky есть защита микрофона и веб-камеры: разреши в ней Nuntius.</>,
      }
    case 'chromium':
      return {
        title,
        lead: (
          <>
            {name} запретил сайту {w.acc}. Это легко вернуть — вот как:
          </>
        ),
        steps:
          browser === 'yandex'
            ? [<>Нажми на замочек слева от адреса сайта</>, <>В списке разрешений найди «{w.nom}» и включи (или выбери «Разрешить»)</>, reload]
            : browser === 'edge'
              ? [<>Нажми на замочек слева от адреса сайта</>, <>«Разрешения для этого сайта» → «{w.nom}» → «Разрешить»</>, reload]
              : [
                  <>Нажми на значок слева от адреса сайта — замочек или «ползунки»</>,
                  <>
                    Найди «{w.nom}» и переключи на «Разрешить» (если пункта нет — «Настройки сайтов» → «{w.nom}» → «Разрешить»)
                  </>,
                  reload,
                ],
        extra: macExtra ?? winExtra,
      }
    case 'firefox':
      return {
        title,
        lead: <>Firefox запретил сайту {w.acc}. Вот как снять запрет:</>,
        steps: [
          <>Нажми на перечёркнутый значок {w.gen} (или на замочек) слева от адреса сайта</>,
          <>У «Использовать {w.acc}» нажми крестик ✕ рядом с «Заблокировано» — запрет снимется</>,
          <>Нажми «Проверить снова» ниже и в окошке выбери «Разрешить»</>,
        ],
        extra: macExtra ?? winExtra,
      }
    case 'safari':
      return {
        title,
        lead: <>Safari запретил сайту {w.acc}. Вот как это поменять:</>,
        steps: [
          <>В меню Safari (вверху слева) открой «Настройки…» → вкладка «Веб-сайты»</>,
          <>
            Слева выбери «{w.nom}», справа у {host()} поставь «Разрешить»
          </>,
          reload,
        ],
        extra: macExtra,
      }
    case 'android':
      return {
        title,
        lead: <>Телефон или браузер запретил сайту {w.acc}. Вот как разрешить:</>,
        steps: [<>Нажми на значок слева от адреса сайта (замочек или «ползунки») → «Разрешения»</>, <>Включи «{w.nom}»</>, reload],
        extra: (
          <>
            Нет такого пункта или не помогло — разреши {w.acc} самому браузеру: Настройки телефона → Приложения → {name} → Разрешения → {w.nom} → «Разрешить».
          </>
        ),
      }
    case 'ios': {
      // На iPhone все браузеры — Safari внутри, но разрешения у каждого свои: в «Настройках» под его названием
      const app = browser === 'safari' || browser === 'other' ? 'Safari' : name
      return {
        title,
        lead: <>iPhone запретил сайту {w.acc}. Вот где это поменять:</>,
        steps: [
          <>Открой «Настройки» iPhone → «{app}»</>,
          app === 'Safari' ? <>Внизу, в «Настройках для веб-сайтов», открой «{w.nom}» → «Спрашивать» или «Разрешить»</> : <>Включи «{w.nom}»</>,
          <>Вернись сюда и обнови страницу</>,
        ],
        extra:
          app === 'Safari' ? (
            <>
              Быстрее: в Safari нажми «аА» слева от адреса → «Настройки веб-сайта» → «{w.nom}» → «Разрешить».
            </>
          ) : undefined,
      }
    }
    default:
      return {
        title,
        lead: <>Браузер запретил сайту {w.acc}. Обычно это меняется так:</>,
        steps: [<>Нажми на значок у адреса сайта или открой настройки браузера → «Разрешения сайтов»</>, <>Разреши {w.acc} для {host()}</>, reload],
        extra: winExtra ?? macExtra,
      }
  }
}

function screenHelp(env: MediaEnv, browser: Browser, os: Os): Help {
  const name = BROWSER_NAME[browser]
  const lead = (
    <>
      Если ты просто нажал «Отмена» в окне выбора — всё в порядке, попробуй ещё раз. А если окно выбора даже не появилось — показ экрана не пускает {os === 'mac' ? 'macOS' : 'браузер'}:
    </>
  )
  if (os === 'mac') {
    return {
      title: 'Демонстрация не запустилась',
      lead,
      steps: [
        <>Открой Системные настройки → «Конфиденциальность и безопасность» → {MAC_PANE.screen}</>,
        <>Включи {name}</>,
        <>Перезапусти {name} — macOS применяет это только после перезапуска</>,
      ],
      extra: env === 'safari' ? <>Ещё проверь Safari: Настройки… → Веб-сайты → «Демонстрация экрана» → у {host()} «Разрешить».</> : undefined,
    }
  }
  return {
    title: 'Демонстрация не запустилась',
    lead,
    steps:
      env === 'firefox'
        ? [<>Нажми на значок слева от адреса сайта</>, <>Если у «Поделиться экраном» стоит «Заблокировано» — нажми крестик ✕</>, <>Нажми «Попробовать снова» и выбери, что показать</>]
        : [<>Нажми на значок слева от адреса сайта</>, <>Если там есть «Демонстрация экрана» или «Запись экрана» — выбери «Разрешить»</>, <>Нажми «Попробовать снова» и выбери, что показать</>],
    extra: <>Не помогло — попробуй Chrome, Edge или Яндекс Браузер на компьютере или приложение Nuntius для Windows.</>,
  }
}

function DeniedModal({ denied }: { denied: NonNullable<MediaHelpState['denied']> }) {
  const { kind, dismissed, stillDenied, checking } = denied
  const env = detectMediaEnv()
  const browser = detectBrowser()
  const os = detectOs()
  const help: Help = dismissed
    ? {
        title: 'Браузер ждёт ответа',
        lead: <>Окошко с вопросом закрылось без ответа — доступ не запрещён, браузер просто не понял, что ты хочешь.</>,
        steps: [<>Нажми «Проверить снова» — браузер спросит ещё раз</>, <>В окошке {PROMPT_WHERE[env]} нажми «Разрешить»</>],
      }
    : kind === 'screen'
      ? screenHelp(env, browser, os)
      : deviceHelp(kind, env, browser, os)
  const sheetRef = useRef<HTMLDivElement>(null)
  // телефон: окно — шторкой снизу, смахивается вниз
  useSheetSwipe(sheetRef, closeMediaHelp, useIsMobile())

  // Esc закрывает окно, а не настройки под ним
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeMediaHelp()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Разрешили в настройках браузера, пока окно открыто, — проверяем сами, без кнопки
  useEffect(() => {
    if (kind === 'screen' || !navigator.permissions?.query) return
    let status: PermissionStatus | null = null
    let alive = true
    navigator.permissions
      .query({ name: (kind === 'mic' ? 'microphone' : 'camera') as PermissionName })
      .then((s) => {
        if (!alive) return
        status = s
        s.onchange = () => s.state === 'granted' && void retryMediaHelp()
      })
      .catch(() => {})
    return () => {
      alive = false
      if (status) status.onchange = null
    }
  }, [kind])

  return (
    <div className="modal-backdrop media-help" onPointerDown={(e) => e.target === e.currentTarget && closeMediaHelp()}>
      <div ref={sheetRef} className="modal glow media-help__modal" role="dialog" aria-modal="true" aria-label={help.title}>
        <button className="modal__close icon-btn" onClick={closeMediaHelp} aria-label="Закрыть">
          <X size={20} />
        </button>
        <span className="media-help__icon">{kind === 'mic' ? <Mic size={22} /> : kind === 'camera' ? <Camera size={22} /> : <MonitorUp size={22} />}</span>
        <h2>{help.title}</h2>
        <p className="modal__subtitle">{help.lead}</p>
        {dismissed ? <PromptPicture env={env} kind={kind} /> : <FixPicture env={env} kind={kind} />}
        <ol className="media-help__steps">
          {help.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {help.extra && <p className="media-help__extra">{help.extra}</p>}
        {stillDenied && (
          <div className="notice notice--error media-help__still">
            {kind === 'screen' ? 'Не получилось — проверь шаги выше.' : `Доступа к ${WORDS[kind].dat} всё ещё нет — проверь шаги выше. Иногда браузеру нужно обновить страницу.`}
          </div>
        )}
        <div className="media-help__actions">
          {stillDenied && env !== 'app' && kind !== 'screen' && (
            <button className="btn btn--ghost" onClick={() => location.reload()}>
              <RefreshCw size={15} /> Обновить страницу
            </button>
          )}
          <button className="btn btn--outline" onClick={closeMediaHelp}>
            Закрыть
          </button>
          <button className="btn btn--primary" onClick={() => void retryMediaHelp()} disabled={checking}>
            {checking ? 'Проверяем…' : kind === 'screen' ? 'Попробовать снова' : 'Проверить снова'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Картинка: где включить запрещённое — у адреса сайта, в настройках телефона или Windows */
function FixPicture({ env, kind }: { env: MediaEnv; kind: MediaKind }) {
  const w = WORDS[kind]
  if (env === 'app' || env === 'ios' || kind === 'screen') {
    // Окно настроек: Windows, iPhone или macOS (экран) — строка раздела и включённый переключатель
    const path = env === 'app' ? `Конфиденциальность и защита › ${w.nom}` : env === 'ios' ? `Настройки › Safari › ${w.nom}` : `Конфиденциальность › Запись экрана`
    const row = env === 'app' ? `Доступ к ${w.dat}` : env === 'ios' ? 'Разрешить' : BROWSER_NAME[detectBrowser()]
    return (
      <div className="mpic mpic--settings" aria-hidden="true">
        <span className="mpic__crumbs">
          <Settings2 size={12} /> {path}
        </span>
        <span className="mpic__row">
          {w.icon}
          <span>{row}</span>
          <span className="mpic__switch is-on" />
        </span>
        {env === 'app' && (
          <span className="mpic__row">
            <span className="mpic__dim">Разрешить классическим приложениям</span>
            <span className="mpic__switch is-on" />
          </span>
        )}
      </div>
    )
  }
  const phone = env === 'android'
  return (
    <div className={`mpic ${phone ? 'mpic--phone mpic--fix' : 'mpic--desk'}`} aria-hidden="true">
      {phone ? (
        <span className="mpic__url mpic__url--phone">
          <span className="mpic__lock is-on">
            <Lock size={9} strokeWidth={3} />
          </span>
          {host()}
        </span>
      ) : (
        <BrowserBar lockOn />
      )}
      <div className="mpic__panel">
        <small>{phone ? 'Разрешения' : host()}</small>
        <span className="mpic__row">
          {w.icon}
          <span>{w.nom}</span>
          {phone ? (
            <span className="mpic__switch is-on" />
          ) : (
            <span className="mpic__select">
              Разрешить <ChevronDown size={10} />
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
