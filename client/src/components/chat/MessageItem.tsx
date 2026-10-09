import type { MouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CornerUpRight } from 'lucide-react'
import type { Message, MessageFlavor } from '../../lib/api'
import { isWishTime } from '../../lib/eggs'
import { formatStamp, formatTime } from '../../lib/format'
import { messageRights, msgUi, useMsgUi } from '../../lib/msgActions'
import { useChat } from '../../lib/store'
import { MessageActions } from '../guild/MessageActions'
import { MessageEditor } from './MessageEditor'
import { Reactions } from './Reactions'
import { ReplyQuote } from './ReplyQuote'

/** Подписи у результатов команд */
const CMD_LABEL: Record<Exclude<MessageFlavor, 'me'>, string> = { roll: '/roll', flip: '/flip', ball: '/8ball' }

/**
 * Правый клик по сообщению — своё меню вместо браузерного.
 * В поле правки и с зажатым Shift остаётся обычное (вставить, проверка орфографии…).
 */
function onContextMenu(e: MouseEvent<HTMLElement>, message: Message) {
  if (e.shiftKey || (e.target instanceof Element && e.target.closest('textarea, input'))) return
  e.preventDefault()
  // выделили кусок текста в этом сообщении — предложим скопировать именно его
  const sel = window.getSelection()
  const selection = sel && !sel.isCollapsed && sel.anchorNode && e.currentTarget.contains(sel.anchorNode) ? sel.toString().trim() : ''
  msgUi.openMenu(message, { kind: 'point', x: e.clientX, y: e.clientY }, 'menu', 'context', selection)
}

/** Подсветка и «активность» строки сообщения: прыгнули к нему по ответу / открыто его меню */
function useRowState(messageId: string) {
  return useMsgUi(
    useShallow((s) => ({
      flash: s.flash === messageId,
      active: s.menu?.messageId === messageId,
      editing: s.editing === messageId,
    })),
  )
}

interface ItemProps {
  message: Message
  /** Пришло только что — с анимацией */
  fresh: boolean
  /** Имя и цвет автора (для «/me») */
  name: string
  color: string | null
}

/** Сообщение человека: цитата ответа, пузырь, реакции */
export function MessageItem({ message: m, fresh, name, color }: ItemProps) {
  const { flash, active, editing } = useRowState(m.id)
  const canReact = useChat((s) => messageRights(s, m).canReact)
  return (
    <div
      className={`msg${flash ? ' is-flash' : ''}${active ? ' is-active' : ''}${editing ? ' is-editing' : ''}`}
      data-mid={m.id}
      onContextMenu={(e) => onContextMenu(e, m)}
    >
      {m.replyTo && <ReplyQuote reply={m.replyTo} channelId={m.channelId} />}
      {editing ? (
        <div className="bubble bubble--editing">
          <MessageEditor message={m} />
        </div>
      ) : (
        <Bubble message={m} fresh={fresh} name={name} color={color} />
      )}
      <Reactions message={m} canReact={canReact} />
    </div>
  )
}

/** Служебное сообщение («теперь вы друзья») — по центру, тоже с реакциями */
export function SystemItem({ message: m, fresh }: { message: Message; fresh: boolean }) {
  const { flash, active } = useRowState(m.id)
  const canReact = useChat((s) => messageRights(s, m).canReact)
  return (
    <div className={`msg msg--sys${flash ? ' is-flash' : ''}${active ? ' is-active' : ''}`} data-mid={m.id} onContextMenu={(e) => onContextMenu(e, m)}>
      <div className={`sysmsg${fresh ? ' sysmsg--fresh' : ''}`}>
        <span className="sysmsg__text">{m.content}</span>
        <time>{formatTime(m.createdAt)}</time>
        {isWishTime(m.createdAt) && <Wish />}
        <MessageActions message={m} />
      </div>
      <Reactions message={m} canReact={canReact} />
    </div>
  )
}

/** Звёздочка у времени 11:11 и 22:22 */
export function Wish() {
  return (
    <span className="wish" data-tip="Загадай желание" aria-label="Загадай желание">
      ✦
    </span>
  )
}

/** Пузырь: обычное сообщение, «/me» (курсивом от третьего лица), результат команды или пересланное */
function Bubble({ message: m, fresh, name, color }: ItemProps) {
  const flavor = m.flavor
  const kind = m.forwarded ? ' bubble--fwd' : flavor === 'me' ? ' bubble--me' : flavor ? ' bubble--cmd' : ''
  return (
    <div className={`bubble${kind}${fresh ? ' bubble--fresh' : ''}`}>
      {m.forwarded ? <ForwardedBody message={m} /> : <Body message={m} name={name} color={color} />}
      <time className="bubble__time" title={formatStamp(m.createdAt)}>
        {formatTime(m.createdAt)}
      </time>
      {isWishTime(m.createdAt) && <Wish />}
      <MessageActions message={m} />
    </div>
  )
}

/** Текст сообщения с учётом команды / «/me» и пометкой «изменено» */
function Body({ message: m, name, color }: { message: Message; name: string; color: string | null }) {
  const flavor = m.flavor
  return (
    <>
      {flavor && flavor !== 'me' && <span className="bubble__cmd">{CMD_LABEL[flavor] ?? '/'}</span>}
      <span className="bubble__text">
        {flavor === 'me' && (
          <>
            <b style={color ? { color } : undefined}>{name}</b>{' '}
          </>
        )}
        {m.content}
        {m.editedAt && (
          <span className="bubble__edited" data-tip={`Изменено: ${formatStamp(m.editedAt).toLowerCase()}`}>
            (изменено)
          </span>
        )}
      </span>
    </>
  )
}

/** Пересланное: «↪ Переслано · Алиса», текст оригинала цитатой и откуда он */
function ForwardedBody({ message: m }: { message: Message }) {
  const fwd = m.forwarded!
  const author = useChat((s) => s.users[fwd.authorId])
  const name = author?.displayName ?? 'Неизвестный'
  return (
    <div className="fwd">
      <div className="fwd__head">
        <CornerUpRight size={13} strokeWidth={2.4} />
        <span>Переслано</span>
        <span className="fwd__dot">·</span>
        <b className="truncate">{name}</b>
      </div>
      <div className={`fwd__quote${m.flavor === 'me' ? ' fwd__quote--me' : ''}`}>
        <Body message={m} name={name} color={null} />
      </div>
      <div className="fwd__from" title={`Написано ${formatStamp(fwd.createdAt).toLowerCase()}`}>
        {fwd.from} · {formatStamp(fwd.createdAt)}
      </div>
    </div>
  )
}
