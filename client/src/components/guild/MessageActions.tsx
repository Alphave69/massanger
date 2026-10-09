import { useEffect, useState, type MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Ellipsis, Reply, SmilePlus, Trash2 } from 'lucide-react'
import type { Message } from '../../lib/api'
import { deleteMessage, messageRights, msgUi, useMsgUi, type MenuState } from '../../lib/msgActions'
import { useChat } from '../../lib/store'

/**
 * Кнопки у сообщения при наведении: реакция, ответить, «ещё» (то же меню, что по правому клику) и удалить.
 * Удалить — своё всегда, чужое — с правом MANAGE_MESSAGES в канале сервера (в личках — только своё).
 * Первый клик — «Точно?», второй — удаляет; с Shift — сразу.
 */
export function MessageActions({ message }: { message: Message }) {
  const rights = useChat(useShallow((s) => messageRights(s, message)))
  // какое меню открыто именно с этих кнопок (а не правым кликом)
  const open = useMsgUi((s) => (s.menu?.messageId === message.id && s.menu.source === 'toolbar' ? s.menu.mode : null))
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  // «Точно?» само сбрасывается, если передумали
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3500)
    return () => window.clearTimeout(t)
  }, [armed])

  const remove = async (e: MouseEvent) => {
    if (busy) return
    if (!armed && !e.shiftKey) return setArmed(true)
    setBusy(true)
    if (!(await deleteMessage(message))) {
      setBusy(false)
      setArmed(false)
    }
  }

  /** Открыть меню (или выбор эмодзи) у кнопки; повторный клик — закрыть */
  const toggle = (e: MouseEvent<HTMLButtonElement>, mode: MenuState['mode']) => {
    if (open === mode) return msgUi.closeMenu()
    const r = e.currentTarget.getBoundingClientRect()
    msgUi.openMenu(message, { kind: 'rect', left: r.left, right: r.right, top: r.top, bottom: r.bottom }, mode, 'toolbar')
  }

  return (
    <div className={`msg-actions${armed ? ' is-armed' : ''}${open ? ' is-open' : ''}`} onMouseLeave={() => !busy && setArmed(false)}>
      <div className="msg-actions__bar">
        {rights.canReact && (
          <button
            className={`msg-actions__btn${open === 'picker' ? ' is-on' : ''}`}
            data-menu-for={message.id}
            onClick={(e) => toggle(e, 'picker')}
            data-tip="Добавить реакцию"
            aria-label="Добавить реакцию"
          >
            <SmilePlus size={15} />
          </button>
        )}
        {rights.canReply && (
          <button className="msg-actions__btn" onClick={() => msgUi.reply(message)} data-tip="Ответить" aria-label="Ответить">
            <Reply size={15} />
          </button>
        )}
        <button
          className={`msg-actions__btn${open === 'menu' ? ' is-on' : ''}`}
          data-menu-for={message.id}
          onClick={(e) => toggle(e, 'menu')}
          data-tip="Ещё"
          aria-label="Ещё действия"
          aria-haspopup="menu"
          aria-expanded={open === 'menu'}
        >
          <Ellipsis size={15} />
        </button>
        {/* остальные кнопки не прячем, пока «Точно?» — иначе кнопка уехала бы из-под курсора */}
        {rights.canDelete && (
          <button
            className={`msg-actions__btn msg-actions__btn--danger${armed ? ' is-armed' : ''}`}
            onClick={(e) => void remove(e)}
            disabled={busy}
            data-tip={armed ? 'Нажми ещё раз' : rights.mine ? 'Удалить (Shift — без вопросов)' : 'Удалить как модератор (Shift — сразу)'}
            aria-label="Удалить сообщение"
          >
            <Trash2 size={14} />
            {armed && <span>{busy ? 'Удаляем…' : 'Точно?'}</span>}
          </button>
        )}
      </div>
    </div>
  )
}
