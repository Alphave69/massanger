import { useEffect, useRef, type MouseEvent } from 'react'
import { SmilePlus } from 'lucide-react'
import type { Message } from '../../lib/api'
import { msgUi, useMsgUi } from '../../lib/msgActions'
import { reactToMessage } from '../../lib/realtime'
import { useChat } from '../../lib/store'

/** Сколько имён показывать в подсказке у реакции */
const TIP_NAMES = 10

/**
 * Реакции под сообщением: «👍 3». Свои подсвечены, клик ставит / снимает,
 * при наведении — кто поставил. Новая реакция «выпрыгивает», число — подпрыгивает.
 */
export function Reactions({ message, canReact }: { message: Message; canReact: boolean }) {
  const meId = useChat((s) => s.me?.id ?? '')
  const users = useChat((s) => s.users)
  const pickerOpen = useMsgUi((s) => s.menu?.messageId === message.id && s.menu.source === 'reactions')
  const entries = Object.entries(message.reactions ?? {})

  // Реакции, которые были уже при загрузке, не «выпрыгивают» — анимируем только новые.
  // Классы анимаций не меняются за жизнь элемента — иначе ответ сервера обрывал бы анимацию на середине
  const track = useRef<{ initial: Set<string>; first: Map<string, number> } | null>(null)
  if (!track.current) track.current = { initial: new Set(entries.map(([emoji]) => emoji)), first: new Map() }
  const { initial, first } = track.current
  for (const [emoji, ids] of entries) if (!first.has(emoji)) first.set(emoji, ids.length)
  useEffect(() => {
    for (const emoji of [...first.keys()]) {
      if (message.reactions?.[emoji]) continue
      first.delete(emoji)
      initial.delete(emoji)
    }
  })

  if (!entries.length) return null

  const names = (ids: string[]) => {
    const list = ids.slice(0, TIP_NAMES).map((id) => (id === meId ? 'ты' : (users[id]?.displayName ?? 'кто-то')))
    const rest = ids.length - list.length
    const text = list.length > 1 ? `${list.slice(0, -1).join(', ')}${rest ? `, ${list[list.length - 1]}` : ` и ${list[list.length - 1]}`}` : list[0]
    return rest ? `${text} и ещё ${rest}` : text
  }

  const openPicker = (e: MouseEvent<HTMLButtonElement>) => {
    if (pickerOpen) return msgUi.closeMenu()
    const r = e.currentTarget.getBoundingClientRect()
    msgUi.openMenu(message, { kind: 'rect', left: r.left, right: r.right, top: r.top, bottom: r.bottom }, 'picker', 'reactions')
  }

  return (
    <div className="reactions">
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(meId)
        return (
          <button
            key={emoji}
            type="button"
            className={`reaction${mine ? ' is-mine' : ''}${initial.has(emoji) ? '' : ' is-new'}`}
            onClick={() => void reactToMessage(message, emoji)}
            // чужую реакцию без права писать не поставить, но свою снять можно всегда
            disabled={!canReact && !mine}
            aria-pressed={mine}
            aria-label={`${emoji} ${ids.length}: ${names(ids)}`}
          >
            <span className="reaction__emoji">{emoji}</span>
            <span key={ids.length} className={`reaction__count${first.get(emoji) !== ids.length ? ' is-bump' : ''}`}>
              {ids.length}
            </span>
            <span className="reaction__tip" role="tooltip">
              <span className="reaction__tip-emoji">{emoji}</span>
              <span>{names(ids)}</span>
            </span>
          </button>
        )
      })}
      {canReact && (
        <button
          type="button"
          className={`reaction reaction--add${pickerOpen ? ' is-open' : ''}`}
          data-menu-for={message.id}
          onClick={openPicker}
          aria-label="Добавить реакцию"
        >
          <SmilePlus size={15} />
        </button>
      )}
    </div>
  )
}
