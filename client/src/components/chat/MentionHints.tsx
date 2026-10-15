import { useEffect, useRef } from 'react'
import { AtSign, Users } from 'lucide-react'
import type { Suggestion } from '../../lib/mentions'
import { Avatar } from '../Avatar'

/** Где мышь была в последний раз — чтобы отличить настоящее движение от «подсказка выскочила под курсором» */
let mouse = { x: -1, y: -1 }
window.addEventListener('mousemove', (e) => (mouse = { x: e.clientX, y: e.clientY }), { capture: true, passive: true })

/** Подсказка над полем ввода после «@»: люди, роли, @everyone / @here */
export function MentionHints({ items, active, onHover, onPick }: { items: Suggestion[]; active: number; onHover: (i: number) => void; onPick: (s: Suggestion) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  // Подсказка появилась прямо под неподвижной мышью — это не выбор (иначе Enter позвал бы, например, @here).
  // Выбор мышью — только после настоящего движения
  const still = useRef<{ x: number; y: number } | null>(mouse)

  // выбранный стрелками пункт всегда на виду
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.cmd-hint.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className="cmd-hints mention-hints" role="listbox" aria-label="Упомянуть" ref={listRef}>
      <div className="cmd-hints__head">Упомянуть</div>
      {items.map((s, i) => (
        <button
          key={s.token}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`cmd-hint mention-hint${i === active ? ' is-active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={(e) => {
            const s = still.current
            if (s && s.x === e.clientX && s.y === e.clientY) return
            still.current = null
            if (i !== active) onHover(i)
          }}
          onClick={() => onPick(s)}
        >
          {s.kind === 'user' ? (
            <>
              <Avatar user={s.user} size={24} />
              <span className="mention-hint__name truncate">{s.user.displayName}</span>
              <span className="mention-hint__sub truncate">@{s.user.username}</span>
            </>
          ) : s.kind === 'role' ? (
            <>
              <span className="mention-hint__icon mention-hint__icon--role" style={s.role.color ? { color: s.role.color } : undefined}>
                <AtSign size={14} strokeWidth={2.6} />
              </span>
              <span className="mention-hint__name truncate" style={s.role.color ? { color: s.role.color } : undefined}>
                {s.role.name}
              </span>
              <span className="mention-hint__sub">роль</span>
            </>
          ) : (
            <>
              <span className="mention-hint__icon">
                <Users size={14} />
              </span>
              <span className="mention-hint__name">@{s.which}</span>
              <span className="mention-hint__sub truncate">{s.which === 'everyone' ? 'позвать всех в канале' : 'позвать всех, кто в сети'}</span>
            </>
          )}
        </button>
      ))}
      <div className="cmd-hints__keys">
        <kbd>↑</kbd>
        <kbd>↓</kbd> выбрать · <kbd>Enter</kbd> или <kbd>Tab</kbd> вставить · <kbd>Esc</kbd> закрыть
      </div>
    </div>
  )
}
