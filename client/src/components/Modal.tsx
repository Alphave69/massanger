import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal glow" role="dialog" aria-modal="true" aria-label={title}>
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
