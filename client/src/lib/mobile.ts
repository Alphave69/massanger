import { useRef, useSyncExternalStore, type MouseEvent, type TouchEvent } from 'react'

/**
 * Телефонная раскладка: один экран за раз (список ↔ чат), выезжающие панели, меню снизу.
 * Тот же запрос — в styles/mobile.css. Телефон боком (низкий экран, палец) — тоже телефон.
 */
export const MOBILE_QUERY = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)'

const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null

export const isMobile = () => Boolean(mql?.matches)

function subscribe(cb: () => void) {
  mql?.addEventListener('change', cb)
  return () => mql?.removeEventListener('change', cb)
}

/** true — сейчас телефонная раскладка (меняется вместе с шириной окна) */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, isMobile, () => false)
}

/**
 * Видимая часть экрана — в CSS-переменные --vvh / --vvtop.
 * На iPhone клавиатура не сжимает страницу (interactive-widget там не работает), а перекрывает её:
 * по этим переменным приложение ужимается до места над клавиатурой, и поле ввода остаётся видно.
 * На Android страница сжимается сама — переменные просто совпадают с окном.
 */
export function trackViewport() {
  const vv = window.visualViewport
  if (!vv) return () => {}
  const root = document.documentElement
  let frame = 0
  const apply = () => {
    frame = 0
    // Увеличили пальцами — раскладку не трогаем, пусть браузер просто масштабирует
    if (vv.scale > 1.01) {
      root.style.removeProperty('--vvh')
      root.style.removeProperty('--vvtop')
      root.classList.remove('kb-open')
      return
    }
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
    root.style.setProperty('--vvtop', `${Math.round(vv.offsetTop)}px`)
    // Клавиатура открыта — отступ под «полоску» iPhone внизу уже не нужен
    root.classList.toggle('kb-open', window.innerHeight - vv.height > 120 || isTextFocused())
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply)
  }
  apply()
  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  window.addEventListener('focusin', schedule)
  window.addEventListener('focusout', schedule)
  return () => {
    cancelAnimationFrame(frame)
    vv.removeEventListener('resize', schedule)
    vv.removeEventListener('scroll', schedule)
    window.removeEventListener('focusin', schedule)
    window.removeEventListener('focusout', schedule)
    root.style.removeProperty('--vvh')
    root.style.removeProperty('--vvtop')
    root.classList.remove('kb-open')
  }
}

/** Метка в истории браузера: «на телефоне есть что закрыть кнопкой Назад» (своя у каждой загрузки страницы) */
const BACK_KEY = 'nuntiusBack'
const PAGE_ID = Math.random().toString(36).slice(2)
const backOnTop = () => (history.state as Record<string, unknown> | null)?.[BACK_KEY] === PAGE_ID

/**
 * Телефон: кнопка «Назад» (Android, жест в браузере) сначала закрывает открытое — шторку, окно, настройки,
 * чат (обратно к списку) — и только когда закрывать нечего, уводит с сайта.
 * Пока что-то открыто, сверху истории лежит одна наша запись. «Назад» снимает её: закрываем верхнее
 * и, если открыто ещё что-то, кладём запись снова. Закрыли сами (крестиком, ←) — снимаем запись сами.
 * sync() — вызывать при каждом открытии и закрытии.
 */
export function trackBackButton(hasOpen: () => boolean, closeTop: () => void) {
  /** Сами вызвали history.back() — ждём, пока запись снимется, и ничего не трогаем */
  let waiting = false
  const sync = () => {
    if (waiting) return
    const need = isMobile() && hasOpen()
    if (need && !backOnTop()) history.pushState({ ...(history.state ?? {}), [BACK_KEY]: PAGE_ID }, '')
    else if (!need && backOnTop()) {
      waiting = true
      history.back()
    }
  }
  const onPop = () => {
    if (waiting) waiting = false
    // нажали «Назад» и сняли нашу запись — закрываем верхнее (sync внутри положит запись снова, если надо)
    else if (!backOnTop() && isMobile() && hasOpen()) closeTop()
    sync()
  }
  window.addEventListener('popstate', onPop)
  mql?.addEventListener('change', sync)
  sync()
  return {
    sync,
    stop() {
      window.removeEventListener('popstate', onPop)
      mql?.removeEventListener('change', sync)
    },
  }
}

const touchScreen = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : null

/** Фокус в поле ввода на телефоне — значит, открыта экранная клавиатура (Android сжимает окно, по высоте это не всегда видно) */
function isTextFocused() {
  const el = document.activeElement
  return (
    Boolean(touchScreen?.matches) &&
    el instanceof HTMLElement &&
    el.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range]), [contenteditable=true]')
  )
}

const LONG_PRESS_MS = 450
/** Палец сдвинулся дальше — это прокрутка, а не долгое нажатие */
const MOVE_TOLERANCE = 10

/**
 * Долгое нажатие пальцем: iPhone не присылает contextmenu, поэтому считаем сами.
 * Отменяется, если палец поехал (прокрутка) или нажали вторым пальцем.
 * Клик после сработавшего нажатия гасим — иначе он «провалился» бы в то, что под пальцем.
 */
export function useLongPress(onLongPress: (x: number, y: number) => void) {
  const timer = useRef(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  const firedAt = useRef(0)
  /** Сработало во время этого касания */
  const fired = useRef(false)
  const cb = useRef(onLongPress)
  cb.current = onLongPress

  const cancel = () => {
    window.clearTimeout(timer.current)
    start.current = null
  }

  return {
    /** Сработало только что — повторное меню (contextmenu на Android) не нужно */
    justFired: () => Date.now() - firedAt.current < 1000,
    cancel,
    handlers: {
      onTouchStart(e: TouchEvent) {
        cancel()
        fired.current = false
        // в поле ввода долгое нажатие — для выделения и вставки текста
        if (e.touches.length !== 1 || (e.target instanceof Element && e.target.closest('textarea, input, [contenteditable=true]'))) return
        const t = e.touches[0]
        const point = { x: t.clientX, y: t.clientY }
        start.current = point
        timer.current = window.setTimeout(() => {
          start.current = null
          fired.current = true
          firedAt.current = Date.now()
          try {
            navigator.vibrate?.(12)
          } catch {
            // вибрации нет — и ладно
          }
          cb.current(point.x, point.y)
        }, LONG_PRESS_MS)
      },
      onTouchMove(e: TouchEvent) {
        const s = start.current
        const t = e.touches[0]
        if (s && t && Math.hypot(t.clientX - s.x, t.clientY - s.y) > MOVE_TOLERANCE) cancel()
      },
      onTouchEnd(e: TouchEvent) {
        cancel()
        // отпустили палец после меню — без «клика» по сообщению под ним
        if (fired.current && e.cancelable) e.preventDefault()
        fired.current = false
      },
      onTouchCancel: cancel,
      onClickCapture(e: MouseEvent) {
        if (Date.now() - firedAt.current < 600) {
          e.preventDefault()
          e.stopPropagation()
        }
      },
    },
  }
}
