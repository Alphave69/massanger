import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { uiZoom } from '../../lib/settings'

interface Props {
  /** Кнопка, у которой открыто меню (клик по ней не считается «мимо») */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  /** start — левым краем к кнопке, end — правым */
  align?: 'start' | 'end'
  className?: string
  children: ReactNode
}

/**
 * Всплывающее меню поверх всего (в прокручиваемых списках и плитках его бы обрезало).
 * Координаты кнопки — в пикселях экрана, а слой масштабирован (.zoomed), поэтому делим на uiZoom().
 */
export function Popover({ anchorRef, onClose, align = 'start', className = '', children }: Props) {
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const close = (e: Event) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) closeRef.current()
    }
    const shut = () => closeRef.current()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc закрывает только меню, а не окно под ним
      e.stopImmediatePropagation()
      shut()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', shut)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', shut)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchorRef])

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect()
    if (!anchor || !popRef.current) return
    const k = uiZoom()
    const w = popRef.current.offsetWidth
    const h = popRef.current.offsetHeight
    const vw = window.innerWidth / k
    const vh = window.innerHeight / k
    const wanted = align === 'end' ? anchor.right / k - w : anchor.left / k
    const left = Math.min(Math.max(8, wanted), vw - w - 8)
    const below = anchor.bottom / k + 6
    const top = below + h > vh - 8 ? Math.max(8, anchor.top / k - h - 6) : below
    setPos({ left, top })
  }, [anchorRef, align])

  return createPortal(
    <div className="zoomed pop-layer">
      <div
        ref={popRef}
        className={`pop ${className}`}
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
