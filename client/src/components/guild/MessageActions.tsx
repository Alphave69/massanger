import { useEffect, useState, type MouseEvent } from 'react'
import { Check, Copy, Trash2 } from 'lucide-react'
import { api, ApiError, SYSTEM_AUTHOR, type Message } from '../../lib/api'
import { can, guildOfChannel } from '../../lib/perms'
import { chat, useChat } from '../../lib/store'

/**
 * Кнопки у сообщения при наведении: скопировать и удалить.
 * Удалить — своё всегда, чужое — с правом MANAGE_MESSAGES в канале сервера (в личках — только своё).
 * Первый клик — «Точно?», второй — удаляет; с Shift — сразу.
 */
export function MessageActions({ message }: { message: Message }) {
  const meId = useChat((s) => s.me?.id)
  const appAdmin = useChat((s) => Boolean(s.me?.admin))
  const guild = useChat((s) => guildOfChannel(s.guilds, message.channelId))
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // «Точно?» само сбрасывается, если передумали
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3500)
    return () => window.clearTimeout(t)
  }, [armed])

  const system = message.authorId === SYSTEM_AUTHOR
  const mine = message.authorId === meId
  const moderator = appAdmin || (guild ? can(guild, 'MANAGE_MESSAGES', message.channelId) : false)
  const canDelete = system ? moderator : mine || moderator

  const remove = async (e: MouseEvent) => {
    if (busy) return
    if (!armed && !e.shiftKey) return setArmed(true)
    setBusy(true)
    try {
      await api.deleteMessage(message.id)
      chat.removeMessage(message.channelId, message.id)
    } catch (err) {
      chat.toast({ title: 'Не удалось удалить', text: err instanceof ApiError ? err.message : 'Что-то пошло не так' })
      setBusy(false)
      setArmed(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // буфер обмена недоступен — текст можно выделить вручную
    }
  }

  if (!canDelete && system) return null

  return (
    <div className={`msg-actions${armed ? ' is-armed' : ''}`} onMouseLeave={() => !busy && setArmed(false)}>
      {!system && !armed && (
        <button className={`msg-actions__btn${copied ? ' is-done' : ''}`} onClick={() => void copy()} data-tip={copied ? 'Скопировано' : 'Копировать текст'} aria-label="Копировать текст">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
      {canDelete && (
        <button
          className={`msg-actions__btn msg-actions__btn--danger${armed ? ' is-armed' : ''}`}
          onClick={(e) => void remove(e)}
          disabled={busy}
          data-tip={armed ? 'Нажми ещё раз' : mine ? 'Удалить (Shift — без вопросов)' : 'Удалить как модератор (Shift — сразу)'}
          aria-label="Удалить сообщение"
        >
          <Trash2 size={14} />
          {armed && <span>{busy ? 'Удаляем…' : 'Точно?'}</span>}
        </button>
      )}
    </div>
  )
}
