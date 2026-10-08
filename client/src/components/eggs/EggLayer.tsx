import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Keyboard, X } from 'lucide-react'
import { closeShortcuts, isSnowSeason, PARTY_MS, startEggs, useEggs } from '../../lib/eggs'
import { keyLabel, useSettings } from '../../lib/settings'

/**
 * Слой пасхалок поверх интерфейса: вечеринка (Konami), «Горячие клавиши» («?») и снег под Новый год.
 * Ничего не перехватывает: всё, кроме окна подсказок, — pointer-events: none.
 */
export function EggLayer() {
  const party = useEggs((s) => s.party)
  const shortcuts = useEggs((s) => s.shortcuts)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const [season] = useState(isSnowSeason)
  const [systemCalm] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => startEggs(), [])

  // вечеринка гаснет сама
  useEffect(() => {
    if (!party) return
    const t = window.setTimeout(() => useEggs.setState({ party: 0 }), PARTY_MS)
    return () => window.clearTimeout(t)
  }, [party])

  return (
    <>
      {season && !reduceMotion && !systemCalm && <Snow />}
      {party > 0 && <Party key={party} calm={reduceMotion || systemCalm} />}
      {shortcuts && <Shortcuts />}
    </>
  )
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Конфетти из белых точек: разлетаются из центра и осыпаются */
function Party({ calm }: { calm: boolean }) {
  const dots = useMemo(
    () =>
      Array.from({ length: calm ? 0 : 90 }, (_, i) => {
        const angle = rand(-Math.PI, 0) // вверх и в стороны
        const power = rand(22, 52)
        return {
          id: i,
          style: {
            '--dx': `${Math.cos(angle) * power}vw`,
            '--dy': `${Math.sin(angle) * power * 0.9}vh`,
            '--fall': `${rand(40, 75)}vh`,
            '--size': `${rand(3, 8).toFixed(1)}px`,
            '--spin': `${rand(-540, 540).toFixed(0)}deg`,
            animationDelay: `${rand(0, 1400).toFixed(0)}ms`,
            animationDuration: `${rand(2600, 4200).toFixed(0)}ms`,
          } as CSSProperties,
          square: i % 3 === 0,
        }
      }),
    [calm],
  )
  return (
    <div className="egg-party" aria-hidden="true">
      <div className="egg-party__glow" />
      {dots.map((d) => (
        <i key={d.id} className={`egg-party__dot${d.square ? ' is-square' : ''}`} style={d.style} />
      ))}
      <div className="egg-party__title">✦ вечеринка ✦</div>
    </div>
  )
}

/** Снег из точек — лёгкий, только CSS-анимации */
function Snow() {
  const flakes = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        id: i,
        style: {
          left: `${rand(0, 100).toFixed(2)}%`,
          '--size': `${rand(1.5, 4).toFixed(1)}px`,
          '--sway': `${rand(-40, 40).toFixed(0)}px`,
          opacity: rand(0.2, 0.6).toFixed(2),
          animationDuration: `${rand(11, 24).toFixed(1)}s`,
          animationDelay: `-${rand(0, 24).toFixed(1)}s`,
        } as CSSProperties,
      })),
    [],
  )
  return (
    <div className="egg-snow" aria-hidden="true">
      {flakes.map((f) => (
        <i key={f.id} style={f.style} />
      ))}
    </div>
  )
}

/** Подсказка «Горячие клавиши» — закрывается по Esc или клику где угодно */
function Shortcuts() {
  const inputMode = useSettings((s) => s.inputMode)
  const pttKey = useSettings((s) => s.pttKey)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation() // Esc закрывает только подсказку, а не настройки под ней
      closeShortcuts()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const rows: { keys: string[]; label: string; secret?: boolean }[] = [
    { keys: ['Enter'], label: 'Отправить сообщение' },
    { keys: ['Shift', 'Enter'], label: 'Новая строка' },
    { keys: ['/'], label: 'Команды в начале сообщения: /roll, /flip, /8ball…' },
    { keys: ['Tab'], label: 'Дописать команду' },
    { keys: ['Esc'], label: 'Закрыть окно, настройки или подсказку' },
    { keys: [keyLabel(pttKey)], label: inputMode === 'ptt' ? 'Говорить, пока зажата (нажми и говори)' : 'Нажми и говори — если включить в «Голос и звук»' },
    { keys: ['?'], label: 'Эта подсказка' },
    { keys: ['↑', '↑', '↓', '↓', '←', '→', '←', '→', 'B', 'A'], label: '???', secret: true },
  ]

  return (
    <div className="egg-keys zoomed" onClick={closeShortcuts} role="dialog" aria-label="Горячие клавиши">
      <div className="egg-keys__card glow" onClick={(e) => e.stopPropagation()}>
        <header className="egg-keys__head">
          <span className="egg-keys__icon">
            <Keyboard size={18} />
          </span>
          <h2>Горячие клавиши</h2>
          <button className="icon-btn" onClick={closeShortcuts} aria-label="Закрыть">
            <X size={18} />
          </button>
        </header>
        <ul className="egg-keys__list">
          {rows.map((r) => (
            <li key={r.label} className={r.secret ? 'is-secret' : undefined}>
              <span className="egg-keys__combo">
                {r.keys.map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </span>
              <span className="egg-keys__label">{r.label}</span>
            </li>
          ))}
        </ul>
        <p className="egg-keys__foot">Клик где угодно или Esc — закрыть</p>
      </div>
    </div>
  )
}
