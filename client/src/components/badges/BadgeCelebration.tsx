import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { rarityOf, rarityText, shiftCelebration, TIER_LABEL, useBadges } from '../../lib/badges'
import { BadgeIcon } from './BadgeIcon'

/** Сколько висит праздник, если его не трогать */
const SHOW_MS = 4500
/** Время на уход — потом следующий из очереди */
const LEAVE_MS = 260
/** Искры вокруг значка */
const SPARKS = Array.from({ length: 16 }, (_, i) => ({
  a: (360 / 16) * i + (i % 2 ? 6 : -4),
  d: 92 + ((i * 37) % 5) * 14,
  s: 3 + (i % 3),
  delay: (i % 4) * 40,
}))

/** Праздник «Новый значок!» поверх интерфейса: по одному из очереди, клик или Esc — закрыть */
export function BadgeCelebration() {
  const current = useBadges((s) => s.queue[0])
  const more = useBadges((s) => Math.max(0, s.queue.length - 1))
  const catalog = useBadges((s) => s.catalog)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef(0)
  const left = useRef(SHOW_MS)
  const startedAt = useRef(0)

  const leavingRef = useRef(false)

  const dismiss = useCallback(() => {
    // Клик и таймер могут совпасть — не пропускаем следующий значок
    if (leavingRef.current) return
    leavingRef.current = true
    window.clearTimeout(timer.current)
    setLeaving(true)
    window.setTimeout(() => {
      leavingRef.current = false
      setLeaving(false)
      shiftCelebration()
    }, LEAVE_MS)
  }, [])

  const run = useCallback(
    (ms: number) => {
      window.clearTimeout(timer.current)
      startedAt.current = Date.now()
      left.current = ms
      timer.current = window.setTimeout(dismiss, ms)
    },
    [dismiss],
  )

  // Новый значок — заводим таймер заново
  useEffect(() => {
    if (!current) return
    run(SHOW_MS)
    return () => window.clearTimeout(timer.current)
  }, [current, run])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc закрывает только праздник, а не настройки/окна под ним
      e.stopImmediatePropagation()
      dismiss()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [current, dismiss])

  if (!current) return null
  const { badge } = current
  const rarity = rarityOf(badge.id, catalog, true)

  // Навели — таймер на паузе (полоска внизу тоже), увели — досчитываем остаток
  const pause = () => {
    window.clearTimeout(timer.current)
    left.current = Math.max(800, left.current - (Date.now() - startedAt.current))
  }
  const resume = () => !leavingRef.current && run(left.current)

  return (
    <div className={`bdg-cele zoomed${leaving ? ' is-leaving' : ''}`} onClick={dismiss} role="alertdialog" aria-live="assertive" aria-label="Новый значок">
      <div
        key={`${badge.id}:${current.at}`}
        className={`bdg-cele__card bdg-cele__card--${badge.tier} glow`}
        onMouseEnter={pause}
        onMouseLeave={resume}
      >
        <div className="bdg-cele__stage">
          <span className="bdg-cele__rays" />
          <span className="bdg-cele__halo" />
          {SPARKS.map((p, i) => (
            <span
              key={i}
              className="bdg-cele__spark"
              style={{ '--a': `${p.a}deg`, '--d': `${p.d}px`, '--sz': `${p.s}px`, animationDelay: `${180 + p.delay}ms` } as CSSProperties}
            />
          ))}
          <span className="bdg-cele__icon">
            <BadgeIcon def={badge} size={112} />
          </span>
        </div>

        <div className="bdg-cele__kicker">Новый значок!</div>
        <h2 className="bdg-cele__name">{badge.name}</h2>
        <p className="bdg-cele__desc">{badge.description}</p>
        <div className="bdg-cele__meta">
          <span className={`bdg-tier bdg-tier--${badge.tier}`}>{TIER_LABEL[badge.tier]}</span>
          {rarity && <span className="bdg-cele__rarity">{rarityText(rarity, true)}</span>}
        </div>
        <div className="bdg-cele__hint">{more > 0 ? `Дальше — ещё ${more} ✦ клик или Esc` : 'Клик или Esc — закрыть'}</div>
        <span className="bdg-cele__timer" style={{ animationDuration: `${SHOW_MS}ms` }} />
      </div>
    </div>
  )
}
