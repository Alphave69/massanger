import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useIsMobile } from '../lib/mobile'
import { useSheetSwipe } from '../lib/swipe'

interface Props {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, subtitle, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // телефон: окно — шторкой снизу, смахивается вниз
  useSheetSwipe(ref, onClose, useIsMobile())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="modal glow" role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal__close icon-btn" onClick={onClose} aria-label="Закрыть">
          <X size={20} />
        </button>
        <h2>{title}</h2>
        {subtitle && <p className="modal__subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  )
}
