import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from 'lucide-react'
import { lightbox, useLightbox } from '../../lib/lightbox'
import { useChat } from '../../lib/store'
import { formatSize } from '../../lib/uploads'

/**
 * Фото на весь экран. Стрелки и ←/→ — между картинками сообщения; клик по фото — приблизить (ещё раз — обратно),
 * колесо и щипок двумя пальцами — масштаб, перетаскивание — двигать приближенное. Свайп вбок — соседнее фото,
 * вниз — закрыть (телефон). Esc, крестик или клик мимо фото — закрыть.
 */
export function Lightbox() {
  const open = useLightbox((s) => s.open)
  if (!open) return null
  return createPortal(<Viewer />, document.body)
}

const MAX_ZOOM = 5
/** Во сколько раз приближает клик */
const CLICK_ZOOM = 2.5

interface View {
  s: number
  x: number
  y: number
}

interface Point {
  x: number
  y: number
}

type Gesture =
  | { kind: 'swipe' | 'pan'; x0: number; y0: number; base: View; moved: boolean; onImage: boolean }
  | { kind: 'pinch'; d0: number; m0: Point; base: View }

const RESET: View = { s: 1, x: 0, y: 0 }
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) || 1
const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function Viewer() {
  const items = useLightbox((s) => s.items)
  const index = useLightbox((s) => s.index)
  const item = items[index]
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [view, setView] = useState<View>(RESET)
  const [drag, setDrag] = useState<Point | null>(null)
  const [busy, setBusy] = useState(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const pointers = useRef(new Map<number, Point>())
  const gesture = useRef<Gesture | null>(null)

  // ушли в другой чат (уведомление, звонок) — просмотр закрываем
  const chatView = useChat((s) => s.view)
  const openedIn = useRef(chatView)
  useEffect(() => {
    if (chatView !== openedIn.current) lightbox.close()
  }, [chatView])

  /** Точка экрана → относительно центра сцены */
  const rel = (p: Point): Point => {
    const r = stageRef.current?.getBoundingClientRect()
    return r ? { x: p.x - (r.left + r.width / 2), y: p.y - (r.top + r.height / 2) } : p
  }

  /** Приближенное фото не уезжает за края дальше, чем нужно, чтобы увидеть его целиком */
  const fit = (v: View): View => {
    const stage = stageRef.current
    const img = imgRef.current
    if (v.s <= 1.01 || !stage || !img) return RESET
    const maxX = Math.max(0, (img.offsetWidth * v.s - stage.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * v.s - stage.clientHeight) / 2)
    return { s: v.s, x: clamp(v.x, -maxX, maxX), y: clamp(v.y, -maxY, maxY) }
  }

  /** Масштаб s с точкой p (от центра сцены), которая остаётся на месте */
  const zoomTo = (s: number, p: Point = { x: 0, y: 0 }) => {
    const v = viewRef.current
    const next = clamp(s, 1, MAX_ZOOM)
    setView(fit({ s: next, x: p.x - (p.x - v.x) * (next / v.s), y: p.y - (p.y - v.y) * (next / v.s) }))
  }

  // Другое фото — с обычного масштаба
  useLayoutEffect(() => {
    setView(RESET)
    setDrag(null)
  }, [index])

  // Клавиатура: перехватываем раньше всех, чтобы Esc закрыл только просмотр
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys: Record<string, () => void> = {
        Escape: lightbox.close,
        ArrowLeft: () => lightbox.go(-1),
        ArrowRight: () => lightbox.go(1),
        '+': () => zoomTo(viewRef.current.s * 1.5),
        '=': () => zoomTo(viewRef.current.s * 1.5),
        '-': () => zoomTo(viewRef.current.s / 1.5),
      }
      const run = keys[e.key]
      if (!run) return
      e.preventDefault()
      e.stopPropagation()
      run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Колесо (и щипок на тачпаде — это колесо с Ctrl): масштаб под курсором. Не пассивный — иначе браузер сам масштабирует страницу
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
      zoomTo(viewRef.current.s * k, rel({ x: e.clientX, y: e.clientY }))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Фокус — на «закрыть»; после закрытия — туда, где был
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    return () => before?.focus?.({ preventScroll: true })
  }, [])

  // Соседние фото — заранее, чтобы листалось без ожидания
  useEffect(() => {
    for (const n of [items[index - 1], items[index + 1]]) {
      if (!n) continue
      const img = new Image()
      img.src = n.url
    }
  }, [index, items])

  if (!item) return null

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const list = [...pointers.current.values()]
    if (list.length === 2) {
      gesture.current = { kind: 'pinch', d0: dist(list[0], list[1]), m0: rel(mid(list[0], list[1])), base: viewRef.current }
      setDrag(null)
      setBusy(true)
      return
    }
    if (list.length > 2) return
    gesture.current = {
      kind: viewRef.current.s > 1 ? 'pan' : 'swipe',
      x0: e.clientX,
      y0: e.clientY,
      base: viewRef.current,
      moved: false,
      onImage: e.target === imgRef.current,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pinch') {
      const list = [...pointers.current.values()]
      if (list.length < 2) return
      const s = clamp((g.base.s * dist(list[0], list[1])) / g.d0, 1, MAX_ZOOM)
      const m = rel(mid(list[0], list[1]))
      // точка между пальцами остаётся под пальцами и едет вместе с ними
      setView(fit({ s, x: m.x - (g.m0.x - g.base.x) * (s / g.base.s), y: m.y - (g.m0.y - g.base.y) * (s / g.base.s) }))
      return
    }
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (!g.moved && Math.hypot(dx, dy) > 6) {
      g.moved = true
      setBusy(true)
    }
    if (!g.moved) return
    if (g.kind === 'pan') setView(fit({ s: g.base.s, x: g.base.x + dx, y: g.base.y + dy }))
    else setDrag({ x: dx, y: dy })
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return
    const g = gesture.current
    if (g?.kind === 'pinch') {
      // отпустили один палец — оставшимся можно двигать
      const rest = [...pointers.current.values()]
      gesture.current = rest.length === 1 ? { kind: 'pan', x0: rest[0].x, y0: rest[0].y, base: viewRef.current, moved: true, onImage: false } : null
      if (!rest.length) setBusy(false)
      return
    }
    gesture.current = null
    setBusy(false)
    setDrag(null)
    if (!g || e.type === 'pointercancel') return
    const dx = e.clientX - g.x0
    const dy = e.clientY - g.y0
    if (g.moved) {
      if (g.kind !== 'swipe') return
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) lightbox.go(dx < 0 ? 1 : -1)
      else if (dy > 90 && dy > Math.abs(dx)) lightbox.close()
      return
    }
    // просто нажали: по фото — приблизить/отдалить, мимо — закрыть
    if (!g.onImage) lightbox.close()
    else if (viewRef.current.s > 1) setView(RESET)
    else zoomTo(CLICK_ZOOM, rel({ x: e.clientX, y: e.clientY }))
  }

  const zoomed = view.s > 1
  const pull = drag ? Math.min(1, Math.max(0, drag.y) / 320) : 0
  const style: CSSProperties = {
    transform: drag ? `translate(${drag.x}px, ${Math.max(0, drag.y) * 0.9}px) scale(${1 - pull * 0.15})` : `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
  }

  return (
    <div className="lightbox" data-no-swipe role="dialog" aria-modal="true" aria-label="Просмотр фото" style={{ '--lb-fade': 1 - pull * 0.8 } as CSSProperties}>
      <div className="lightbox__bar">
        {items.length > 1 && (
          <span className="lightbox__count">
            {index + 1} / {items.length}
          </span>
        )}
        <span className="lightbox__name truncate" title={item.name}>
          {item.name}
        </span>
        <span className="lightbox__size">{formatSize(item.size)}</span>
        <span className="lightbox__tools">
          <button type="button" className="lightbox__btn" onClick={() => (zoomed ? setView(RESET) : zoomTo(CLICK_ZOOM))} aria-label={zoomed ? 'Отдалить' : 'Приблизить'} data-tip={zoomed ? 'Отдалить' : 'Приблизить'}>
            {zoomed ? <ZoomOut size={19} /> : <ZoomIn size={19} />}
          </button>
          <a className="lightbox__btn" href={`${item.url}?dl=1`} download={item.name} aria-label="Скачать" data-tip="Скачать">
            <Download size={19} />
          </a>
          <button ref={closeRef} type="button" className="lightbox__btn" onClick={lightbox.close} aria-label="Закрыть" data-tip="Закрыть · Esc">
            <X size={21} />
          </button>
        </span>
      </div>

      <div
        ref={stageRef}
        className={`lightbox__stage${busy ? ' is-busy' : ''}${zoomed ? ' is-zoomed' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          ref={imgRef}
          key={item.id}
          className="lightbox__img"
          src={item.url}
          alt={item.name}
          width={item.width}
          height={item.height}
          draggable={false}
          style={style}
        />
      </div>

      {index > 0 && (
        <button type="button" className="lightbox__nav lightbox__nav--prev" onClick={() => lightbox.go(-1)} aria-label="Предыдущее фото">
          <ChevronLeft size={26} />
        </button>
      )}
      {index < items.length - 1 && (
        <button type="button" className="lightbox__nav lightbox__nav--next" onClick={() => lightbox.go(1)} aria-label="Следующее фото">
          <ChevronRight size={26} />
        </button>
      )}
    </div>
  )
}
