import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { EMOJI_GROUPS, recentEmoji } from '../../lib/msgActions'

interface Props {
  /** Уже стоит моя реакция — подсвечиваем (повторный клик её снимет) */
  isMine: (emoji: string) => boolean
  onPick: (emoji: string) => void
}

/** Компактный выбор эмодзи: недавние + несколько групп. Стрелки ходят по сетке, Enter — выбрать */
export function EmojiPicker({ isMine, onPick }: Props) {
  const [recent] = useState(recentEmoji)
  const groups = recent.length ? [{ title: 'Недавние', list: recent }, ...EMOJI_GROUPS] : EMOJI_GROUPS
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    gridRef.current?.querySelector<HTMLButtonElement>('.emoji-picker__btn')?.focus({ preventScroll: true })
  }, [])

  // Стрелки: влево/вправо — соседняя, вверх/вниз — ближайшая по горизонтали в соседнем ряду
  const onKeyDown = (e: KeyboardEvent) => {
    const grid = gridRef.current
    if (!grid || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    const btns = [...grid.querySelectorAll<HTMLButtonElement>('.emoji-picker__btn')]
    const i = btns.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    e.stopPropagation()
    let next = i
    if (e.key === 'ArrowLeft') next = Math.max(0, i - 1)
    else if (e.key === 'ArrowRight') next = Math.min(btns.length - 1, i + 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = btns.length - 1
    else {
      const cur = btns[i].getBoundingClientRect()
      const down = e.key === 'ArrowDown'
      const rows = btns.map((b, j) => ({ j, r: b.getBoundingClientRect() })).filter(({ r }) => (down ? r.top > cur.top + 2 : r.top < cur.top - 2))
      if (rows.length) {
        const rowTop = down ? Math.min(...rows.map(({ r }) => r.top)) : Math.max(...rows.map(({ r }) => r.top))
        const row = rows.filter(({ r }) => Math.abs(r.top - rowTop) < 2)
        const cx = cur.left + cur.width / 2
        next = row.reduce((a, b) => (Math.abs(b.r.left + b.r.width / 2 - cx) < Math.abs(a.r.left + a.r.width / 2 - cx) ? b : a)).j
      }
    }
    btns[next].focus()
    btns[next].scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="emoji-picker" ref={gridRef} onKeyDown={onKeyDown}>
      {groups.map((g) => (
        <section key={g.title} className="emoji-picker__group" aria-label={g.title}>
          <div className="emoji-picker__title">{g.title}</div>
          <div className="emoji-picker__grid">
            {g.list.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={`emoji-picker__btn${isMine(emoji) ? ' is-mine' : ''}`}
                onClick={() => onPick(emoji)}
                aria-label={isMine(emoji) ? `Убрать ${emoji}` : `Реакция ${emoji}`}
                aria-pressed={isMine(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
