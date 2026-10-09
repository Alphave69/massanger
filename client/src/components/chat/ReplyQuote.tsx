import { useEffect } from 'react'
import { CornerUpLeft, X } from 'lucide-react'
import { SYSTEM_AUTHOR, type ReplyRef } from '../../lib/api'
import { findLoaded, focusComposer, jumpToMessage, msgUi, useMsgUi } from '../../lib/msgActions'
import { guildOfChannel, roleColor } from '../../lib/perms'
import { chat, useChat } from '../../lib/store'
import { Avatar } from '../Avatar'

/** Текст для цитаты — в одну строку */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Имя и цвет (роль на сервере) автора — для цитат */
function useAuthor(authorId: string, channelId: string) {
  const user = useChat((s) => s.users[authorId])
  const color = useChat((s) => {
    const guild = guildOfChannel(s.guilds, channelId)
    return guild ? roleColor(guild, authorId) : null
  })
  const name = authorId === SYSTEM_AUTHOR ? 'Nuntius' : (user?.displayName ?? 'Неизвестный')
  return { user, name, color }
}

/**
 * Цитата над сообщением-ответом: мини-аватар, имя, начало текста.
 * Если оригинал загружен — показываем его текущий текст (вдруг его исправили), иначе — снимок.
 * Клик — прокрутить к оригиналу и подсветить его.
 */
export function ReplyQuote({ reply, channelId }: { reply: ReplyRef; channelId: string }) {
  const { user, name, color } = useAuthor(reply.authorId, channelId)
  const live = useChat((s) => findLoaded(s, channelId, reply.id)?.content)
  const text = oneLine(live ?? reply.content)

  const jump = () => {
    if (!jumpToMessage(reply.id)) chat.toast({ title: 'Сообщение не найдено', text: 'Его удалили — или оно слишком далеко в истории' })
  }

  return (
    <button type="button" className="reply-quote" onClick={jump} aria-label={`Ответ на сообщение ${name}: ${text}`}>
      <span className="reply-quote__spine" aria-hidden="true" />
      {user ? <Avatar user={user} size={16} /> : <span className="reply-quote__dot" aria-hidden="true" />}
      <b className="reply-quote__name" style={color ? { color } : undefined}>
        {name}
      </b>
      <span className="reply-quote__text truncate">{text || '…'}</span>
    </button>
  )
}

/** Плашка над полем ввода: «Ответ Алисе: …» с крестиком. Esc в поле тоже отменяет */
export function ReplyBar({ channelId }: { channelId: string }) {
  const replyId = useMsgUi((s) => s.replies[channelId])
  const loaded = useChat((s) => s.messages[channelId] !== undefined)
  const target = useChat((s) => (replyId ? findLoaded(s, channelId, replyId) : undefined))
  const { name, color } = useAuthor(target?.authorId ?? '', channelId)

  // Оригинал удалили, пока писали ответ, — отвечать больше не на что
  const gone = Boolean(replyId) && loaded && !target
  useEffect(() => {
    if (gone) msgUi.cancelReply(channelId)
  }, [gone, channelId])

  if (!replyId || !target) return null

  return (
    <div className="reply-bar">
      <CornerUpLeft size={15} className="reply-bar__icon" />
      <span className="reply-bar__text truncate">
        Ответ <b style={color ? { color } : undefined}>{name}</b>
        <span className="reply-bar__snippet">: {oneLine(target.content)}</span>
      </span>
      <button
        type="button"
        className="reply-bar__close"
        onClick={() => {
          msgUi.cancelReply(channelId)
          focusComposer()
        }}
        aria-label="Отменить ответ"
        data-tip="Отменить · Esc"
      >
        <X size={15} />
      </button>
    </div>
  )
}
