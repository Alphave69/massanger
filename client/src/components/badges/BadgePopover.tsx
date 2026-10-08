import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { CalendarCheck, Lock, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { badgeDef, calmMotion, loadBadges, progressUnit, rarityOf, rarityText, TIER_LABEL, unknownBadge, useBadges } from '../../lib/badges'
import { formatDay } from '../../lib/format'
import { uiZoom } from '../../lib/settings'
import { BadgeIcon } from './BadgeIcon'

const WIDTH = 288
const GAP = 10
const EDGE = 8

/** Подписи, когда значок крутят (по кругу) */
const SPINS = ['Вжух!', 'Ещё разок?', 'Блестит же', 'Голова не кружится?', 'Ладно, хватит 😵']

interface Props {
  badgeId: string
  /** Когда получен; нет — ещё не получен */
  earnedAt?: number
  /** Смотрим свои значки: тогда есть прогресс и «только у тебя» */
  self?: boolean
  /** Элемент, у которого открыта карточка (клик по нему не считается «мимо») */
  anchor: HTMLElement
  onClose: () => void
}

/**
 * Подробности значка во всплывашке поверх всего (в т.ч. поверх настроек и карточки профиля).
 * Слой масштабирован (.zoomed), а координаты кнопки — экранные, поэтому делим на uiZoom().
 */
export function BadgePopover({ badgeId, earnedAt, self, anchor, onClose }: Props) {
  const catalog = useBadges((s) => s.catalog)
  const popRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; above: boolean } | null>(null)
  const [spin, setSpin] = useState(0)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Проценты редкости — свежие
  useEffect(() => void loadBadges(), [])

  useEffect(() => {
    const pop = popRef.current
    // Клики внутри не должны закрывать карточку профиля/своё меню, в которых живёт строка значков
    const stop = (e: Event) => e.stopPropagation()
    pop?.addEventListener('pointerdown', stop)
    const outside = (e: Event) => {
      const t = e.target as Node
      if (!pop?.contains(t) && !anchor.contains(t)) closeRef.current()
    }
    // Закрываем, только если прокрутили то, в чём лежит значок (чат, который сам листается, не мешает)
    const onScroll = (e: Event) => {
      const t = e.target
      if (t instanceof Node && t.contains(anchor)) closeRef.current()
    }
    const shut = () => closeRef.current()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc закрывает только карточку значка, а не настройки под ней
      e.stopImmediatePropagation()
      shut()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('resize', shut)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      pop?.removeEventListener('pointerdown', stop)
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', shut)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchor])

  useLayoutEffect(() => {
    if (!popRef.current) return
    const k = uiZoom()
    const r = anchor.getBoundingClientRect()
    const h = popRef.current.offsetHeight
    const vw = window.innerWidth / k
    const vh = window.innerHeight / k
    const cx = (r.left + r.width / 2) / k
    const left = Math.min(Math.max(EDGE, cx - WIDTH / 2), vw - WIDTH - EDGE)
    const below = r.bottom / k + GAP
    const above = below + h > vh - EDGE && r.top / k - GAP - h > EDGE
    const top = above ? r.top / k - GAP - h : Math.min(below, Math.max(EDGE, vh - h - EDGE))
    setPos({ left, top, arrow: Math.min(Math.max(18, cx - left), WIDTH - 18), above })
  }, [anchor, badgeId, catalog])

  const def = badgeDef(badgeId, catalog) ?? (catalog ? unknownBadge(badgeId) : null)
  const earned = earnedAt !== undefined
  const rarity = rarityOf(badgeId, catalog, earned)
  const progress = self && !earned ? catalog?.progress[badgeId] : undefined

  // Значок поворачивается за курсором — как голографическая карточка
  const tilt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = heroRef.current
    if (!el || calmMotion()) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.setProperty('--ry', `${(x * 34).toFixed(1)}deg`)
    el.style.setProperty('--rx', `${(-y * 34).toFixed(1)}deg`)
    el.style.setProperty('--px', `${((x + 0.5) * 100).toFixed(0)}%`)
    el.style.setProperty('--py', `${((y + 0.5) * 100).toFixed(0)}%`)
  }
  const untilt = () => {
    const el = heroRef.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  return createPortal(
    <div className="zoomed bdg-layer">
      <div
        ref={popRef}
        className={`bdg-pop glow${pos?.above ? ' is-above' : ''}${def ? ` bdg-pop--${def.tier}` : ''}`}
        role="dialog"
        aria-label={def?.name ?? 'Значок'}
        style={
          {
            width: WIDTH,
            left: pos?.left ?? -9999,
            top: pos?.top ?? 0,
            visibility: pos ? 'visible' : 'hidden',
            '--arrow': `${pos?.arrow ?? WIDTH / 2}px`,
          } as CSSProperties
        }
      >
        <span className="bdg-pop__arrow" />
        {!def ? (
          <div className="bdg-pop__loading">
            <span className="bdg-skel" />
            <span className="bdg-skel bdg-skel--line" />
            <span className="bdg-skel bdg-skel--line bdg-skel--short" />
          </div>
        ) : (
          <>
            <div className="bdg-pop__hero" ref={heroRef} onPointerMove={tilt} onPointerLeave={untilt}>
              <button
                key={spin}
                className={`bdg-pop__medal${spin ? ' is-spinning' : ''}`}
                onClick={() => setSpin((n) => n + 1)}
                aria-label="Покрутить значок"
              >
                <BadgeIcon def={def} size={76} locked={!earned} />
                <span className="bdg-pop__sheen" />
              </button>
              {spin > 0 && (
                <span key={`t${spin}`} className="bdg-pop__quip">
                  {SPINS[(spin - 1) % SPINS.length]}
                </span>
              )}
            </div>

            <div className="bdg-pop__body">
              <span className={`bdg-tier bdg-tier--${def.tier}`}>{TIER_LABEL[def.tier]}</span>
              <h4 className="bdg-pop__name">{def.name}</h4>
              <p className="bdg-pop__desc">{def.description}</p>

              <ul className="bdg-pop__facts">
                {earned ? (
                  <li>
                    <CalendarCheck size={14} />
                    <span>Получен {formatDay(earnedAt)}</span>
                  </li>
                ) : (
                  <li className="is-dim">
                    <Lock size={14} />
                    <span>{def.secret ? 'Секретный — условия откроются, когда получишь' : self ? 'Ещё не получен' : 'Не получен'}</span>
                  </li>
                )}
                {def.manual && (
                  <li>
                    <ShieldCheck size={14} />
                    <span>{earned ? 'Выдан администрацией' : 'Выдаёт только администрация'}</span>
                  </li>
                )}
                {def.secret && earned && (
                  <li>
                    <Sparkles size={14} />
                    <span>Секретный значок — мало кто знает, как его получить</span>
                  </li>
                )}
              </ul>

              {progress && progress.target > 0 && (
                <div className="bdg-pop__progress">
                  <div className="bdg-bar">
                    <span style={{ width: `${Math.min(100, (progress.current / progress.target) * 100)}%` }} />
                  </div>
                  <span className="bdg-pop__count">
                    {Math.min(progress.current, progress.target)} / {progress.target}
                    {progressUnit(def.id)}
                  </span>
                </div>
              )}

              <div className="bdg-pop__rarity">
                <Users size={14} />
                {rarity ? (
                  <>
                    <span className="bdg-pop__rarity-text">{rarityText(rarity, earned && self)}</span>
                    <span className="bdg-rarity">
                      <span style={{ width: `${Math.max(rarity.holders ? 3 : 0, Math.min(100, rarity.pct))}%` }} />
                    </span>
                  </>
                ) : (
                  <span className="bdg-pop__rarity-text">Считаем, у скольких он есть…</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
