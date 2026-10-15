import { useEffect, useRef, type RefObject } from 'react'
import { detectOs, isStandalone } from './platform'

/**
 * Свайпы на телефоне: панель едет за пальцем, а когда отпустили — докатывается до конца
 * (протащили дальше 35% или резко махнули) или возвращается на место.
 * Сторону решаем после первых ~10px: вбок — только если |dx| > 1.5·|dy|, вниз — наоборот.
 * Не перехватываем: поля ввода и выделенный текст, то, что само листается вбок (код, вкладки, эмодзи),
 * ползунки, видео и картинки на весь экран ([data-no-swipe]), полноэкранный режим, увеличенную пальцами страницу,
 * долгое нажатие (палец стоял на месте — это меню, а не свайп).
 * Safari на iPhone (во вкладке, не со значка на экране Домой) у края экрана листает историю сам — оттуда не начинаем.
 */

export type SwipeDir = 'left' | 'right' | 'up' | 'down'

export interface SwipeGesture {
  /** Полный путь панели в пикселях экрана (её ширина или высота) — от него считаются 35% */
  size: number
  /** Палец сдвинулся на px (0…size) в сторону свайпа */
  move(px: number): void
  /** Отпустили: commit — довести до конца, иначе вернуть на место */
  end(commit: boolean): void
}

export interface SwipeOptions {
  /** Какой жест начать в эту сторону (null — никакого: касание остаётся браузеру) */
  start(dir: SwipeDir): SwipeGesture | null
}

/** Сдвиг, после которого понятно, куда ведут палец */
const INTENT = 10
/** Во сколько раз движение вбок должно быть больше, чем вверх-вниз (и наоборот) */
const RATIO = 1.5
/** Край экрана, который в Safari занят жестом «назад/вперёд» */
const EDGE = 24
/** Дальше этой доли — панель докатывается сама */
const COMMIT = 0.35
/** Резкий взмах, px/мс — хватает и короткого */
const FLICK = 0.45
/** Палец простоял дольше — это долгое нажатие (меню), а не свайп (как LONG_PRESS_MS в mobile.ts) */
const LONG_PRESS_MS = 450

const NO_SWIPE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], video[controls], audio, [data-no-swipe]'

/** Анимации выключены (в настройках или в системе) — панель не ведём за пальцем, просто переключаем */
export const reducedMotion = () =>
  document.documentElement.classList.contains('reduce-motion') || Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

const iosBrowser = () => detectOs() === 'ios' && !isStandalone()

const scrollable = (o: string) => o === 'auto' || o === 'scroll'

/** Между пальцем и корнем есть что-то, что само листается вбок (и ему есть куда) */
function scrollsSideways(from: Element, root: Element) {
  for (let el: Element | null = from; el && el !== root.parentElement; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && scrollable(getComputedStyle(el).overflowX)) return true
  }
  return false
}

/** Между пальцем и корнем есть прокрутка, которая не в самом верху: свайп вниз сначала листает её */
function scrolledDown(from: Element, root: Element) {
  for (let el: Element | null = from; el && el !== root.parentElement; el = el.parentElement) {
    if (el.scrollTop > 0 && scrollable(getComputedStyle(el).overflowY)) return true
  }
  return false
}

/** Кто из вложенных корней уже ведёт это касание: внутренний (шторка) важнее внешнего (весь экран) */
let owner: HTMLElement | null = null

/** После свайпа отпущенный палец не должен «нажать» то, что под ним */
function swallowClick() {
  const stop = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }
  window.addEventListener('click', stop, true)
  window.setTimeout(() => window.removeEventListener('click', stop, true), 400)
}

interface Track {
  x0: number
  y0: number
  t0: number
  target: Element
  dir?: SwipeDir
  gesture?: SwipeGesture
  /** Сколько палец прошёл до того, как жест начался, — панель едет от этого места, без скачка */
  from: number
  px: number
  samples: { p: number; t: number }[]
  frame: number
}

const along = (dir: SwipeDir, dx: number, dy: number) => (dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy)

/** Слушаем касания на корне. Возвращает «отписаться» */
export function attachSwipe(root: HTMLElement, options: () => SwipeOptions) {
  let t: Track | null = null

  const drop = () => {
    if (t) cancelAnimationFrame(t.frame)
    if (t?.gesture && owner === root) owner = null
    t = null
  }

  const onStart = (e: TouchEvent) => {
    // второй палец посреди свайпа — возвращаем панель на место
    if (t?.gesture) finish(false)
    else drop()
    if (e.touches.length !== 1) return
    const target = e.target
    if (!(target instanceof Element) || target.closest(NO_SWIPE)) return
    if (document.fullscreenElement) return
    // страницу увеличили пальцами — палец двигает её, а не панели
    if ((window.visualViewport?.scale ?? 1) > 1.01) return
    // выделяют текст — не мешаем
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.toString().trim()) return
    const touch = e.touches[0]
    t = { x0: touch.clientX, y0: touch.clientY, t0: e.timeStamp, target, from: 0, px: 0, samples: [], frame: 0 }
  }

  const onMove = (e: TouchEvent) => {
    if (!t) return
    // второй палец — это масштаб, не свайп
    if (e.touches.length !== 1) return finish(false)
    const touch = e.touches[0]
    const dx = touch.clientX - t.x0
    const dy = touch.clientY - t.y0

    if (!t.gesture) {
      // это касание уже ведёт шторка внутри нас
      if (owner && owner !== root) return drop()
      if (Math.hypot(dx, dy) < INTENT) return
      if (e.timeStamp - t.t0 > LONG_PRESS_MS) return drop()
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      const dir: SwipeDir | null = ax > RATIO * ay ? (dx > 0 ? 'right' : 'left') : ay > RATIO * ax ? (dy > 0 ? 'down' : 'up') : null
      if (!dir) return drop()
      const sideways = dir === 'left' || dir === 'right'
      if (sideways && scrollsSideways(t.target, root)) return drop()
      if (dir === 'down' && scrolledDown(t.target, root)) return drop()
      if (sideways && iosBrowser() && ((dir === 'right' && t.x0 < EDGE) || (dir === 'left' && t.x0 > window.innerWidth - EDGE))) return drop()
      const gesture = options().start(dir)
      if (!gesture || gesture.size <= 0) return drop()
      t.dir = dir
      t.gesture = gesture
      t.from = along(dir, dx, dy)
      owner = root
    }

    // дальше палец наш: страница под ним не листается
    if (e.cancelable) e.preventDefault()
    const p = along(t.dir!, dx, dy) - t.from
    t.px = Math.max(0, Math.min(p, t.gesture.size))
    t.samples.push({ p, t: e.timeStamp })
    while (t.samples.length > 2 && e.timeStamp - t.samples[0].t > 100) t.samples.shift()
    if (reducedMotion() || t.frame) return
    t.frame = requestAnimationFrame(() => {
      if (!t?.gesture) return
      t.frame = 0
      t.gesture.move(t.px)
    })
  }

  /** Скорость в сторону свайпа за последние ~100 мс, px/мс */
  const speed = (track: Track) => {
    const s = track.samples
    if (s.length < 2) return 0
    const a = s[0]
    const b = s[s.length - 1]
    return b.t > a.t ? (b.p - a.p) / (b.t - a.t) : 0
  }

  const finish = (released: boolean, e?: TouchEvent) => {
    const track = t
    if (!track?.gesture) return drop()
    const v = speed(track)
    const size = track.gesture.size
    const commit = released && v > -0.2 && (track.px > COMMIT * size || (v > FLICK && track.px > 16))
    const gesture = track.gesture
    drop()
    if (e?.cancelable) e.preventDefault()
    swallowClick()
    gesture.end(commit)
  }

  const onEnd = (e: TouchEvent) => {
    if (t && e.touches.length === 0) finish(true, e)
  }
  const onCancel = () => finish(false)

  root.addEventListener('touchstart', onStart, { passive: true })
  // не passive: когда жест наш, отменяем прокрутку страницы
  root.addEventListener('touchmove', onMove, { passive: false })
  root.addEventListener('touchend', onEnd)
  root.addEventListener('touchcancel', onCancel)
  return () => {
    finish(false)
    root.removeEventListener('touchstart', onStart)
    root.removeEventListener('touchmove', onMove)
    root.removeEventListener('touchend', onEnd)
    root.removeEventListener('touchcancel', onCancel)
  }
}

/** Свайпы на элементе ref, пока active (обычно — пока телефонная раскладка) */
export function useSwipe(ref: RefObject<HTMLElement | null>, options: SwipeOptions, active = true) {
  const latest = useRef(options)
  latest.current = options
  useEffect(() => {
    const el = ref.current
    if (!active || !el) return
    return attachSwipe(el, () => latest.current)
  }, [active, ref])
}

// ============ помощники: панель за пальцем ============

type Styles = Partial<Record<'translate' | 'opacity' | 'visibility', string>>
const PROPS = ['transition', 'translate', 'opacity', 'visibility'] as const

/** Пока палец ведёт — без анимации, ровно за пальцем */
export function hold(el: HTMLElement | null | undefined, styles: Styles) {
  if (!el) return
  el.style.setProperty('transition', 'none')
  for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v)
}

/** Убираем свои стили — CSS сам докатит панель туда, где ей положено быть */
export function letGo(...els: (HTMLElement | null | undefined)[]) {
  for (const el of els) if (el) for (const k of PROPS) el.style.removeProperty(k)
}

/**
 * Отпустили: сначала меняем состояние (React перерисует классы), кадром позже убираем свои стили —
 * тогда переход CSS идёт от того места, где панель оставил палец. Без change — просто вернуть.
 */
export function settle(els: (HTMLElement | null | undefined)[], change?: () => void) {
  if (!change) return letGo(...els)
  change()
  requestAnimationFrame(() => letGo(...els))
}

/** Панель, которая закрывается целиком (шторка, настройки): доезжает за край и только потом закрывается */
export function slideAway(el: HTMLElement, to: 'right' | 'down', done: () => void, shade?: HTMLElement | null) {
  if (reducedMotion()) return done()
  const ease = '0.2s cubic-bezier(0.4, 0, 1, 1)'
  el.style.setProperty('transition', `translate ${ease}`)
  el.style.setProperty('translate', to === 'right' ? '100% 0' : '0 100%')
  if (shade) {
    shade.style.setProperty('transition', `opacity ${ease}`)
    shade.style.setProperty('opacity', '0')
  }
  window.setTimeout(done, 190)
}

/**
 * Шторка снизу (меню, профиль, окно): тянем вниз — едет за пальцем, отпустили ниже 35% — закрывается.
 * shade — затемнение под шторкой, бледнеет вместе с ней.
 */
export function useSheetSwipe(ref: RefObject<HTMLElement | null>, close: () => void, active: boolean, shade?: () => HTMLElement | null | undefined) {
  useSwipe(
    ref,
    {
      start(dir) {
        const el = ref.current
        if (dir !== 'down' || !el) return null
        const bg = shade?.()
        const size = el.getBoundingClientRect().height
        return {
          size,
          move(px) {
            const p = px / size
            hold(el, { translate: `0 ${(p * 100).toFixed(2)}%` })
            hold(bg, { opacity: String(1 - p) })
          },
          end(commit) {
            if (commit) slideAway(el, 'down', close, bg)
            else letGo(el, bg)
          },
        }
      },
    },
    active,
  )
}
