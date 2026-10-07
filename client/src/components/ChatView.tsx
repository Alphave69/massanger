import { Fragment, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Hash, SendHorizontal, Users } from 'lucide-react'
import type { Channel, Message, User } from '../lib/api'
import { formatDay, formatStamp, formatTime, sameDay } from '../lib/format'
import { Avatar } from './Avatar'

interface Props {
  channel: Channel | null
  messages: Message[] | undefined
  usersById: Map<string, User>
  currentUserId: string
  typingUserIds: string[]
  membersOpen: boolean
  onToggleMembers: () => void
  onSend: (content: string) => Promise<boolean>
  onTyping: () => void
}

const GROUP_WINDOW = 7 * 60 * 1000

const UNKNOWN: User = { id: 'unknown', username: 'unknown', displayName: 'Неизвестный' }

export function ChatView(props: Props) {
  const { channel, messages, usersById, currentUserId, typingUserIds, membersOpen, onToggleMembers } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  // Сообщения, которые уже были в канале при его открытии, не анимируем — только новые
  const baseline = useRef<{ channelId: string | null; ids: Set<string> | null }>({ channelId: null, ids: null })
  const channelId = channel?.id ?? null
  if (baseline.current.channelId !== channelId) {
    baseline.current = { channelId, ids: null }
    stickToBottom.current = true
  }
  if (!baseline.current.ids && messages) baseline.current.ids = new Set(messages.map((m) => m.id))
  const known = baseline.current.ids

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !messages) return
    const last = messages[messages.length - 1]
    if (stickToBottom.current || last?.authorId === currentUserId) el.scrollTop = el.scrollHeight
  }, [messages, currentUserId])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const typingNames = typingUserIds.map((id) => usersById.get(id)?.displayName ?? '…')

  return (
    <section className="chat">
      <header className="chat__header">
        <Hash size={22} className="chat__header-icon" />
        <h2 className="truncate">{channel?.name ?? ''}</h2>
        <div className="chat__header-actions">
          <button
            className={`icon-btn${membersOpen ? ' is-active' : ''}`}
            onClick={onToggleMembers}
            aria-label="Участники"
            aria-pressed={membersOpen}
            data-tip="Участники"
          >
            <Users size={20} />
          </button>
        </div>
      </header>

      <div className="chat__scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat__spacer" />
        {channel && (
          <div className="chat__welcome" key={channel.id}>
            <div className="chat__welcome-icon">
              <Hash size={38} />
            </div>
            <h3>Добро пожаловать в #{channel.name}!</h3>
            <p>Это начало канала #{channel.name}. Напиши что-нибудь первым.</p>
          </div>
        )}

        {messages === undefined && <MessageSkeleton />}

        {messages?.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt)
          const grouped = !newDay && prev.authorId === m.authorId && m.createdAt - prev.createdAt < GROUP_WINDOW
          const author = usersById.get(m.authorId) ?? UNKNOWN
          const fresh = known !== null && !known.has(m.id)
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="divider">
                  <span>{formatDay(m.createdAt)}</span>
                </div>
              )}
              <article className={`msg${grouped ? ' msg--grouped' : ''}${fresh ? ' msg--fresh' : ''}`}>
                {grouped ? (
                  <time className="msg__hover-time" dateTime={new Date(m.createdAt).toISOString()}>
                    {formatTime(m.createdAt)}
                  </time>
                ) : (
                  <div className="msg__avatar">
                    <Avatar user={author} size={40} />
                  </div>
                )}
                <div className="msg__body">
                  {!grouped && (
                    <div className="msg__meta">
                      <span className="msg__author">{author.displayName}</span>
                      <time className="msg__time" dateTime={new Date(m.createdAt).toISOString()}>
                        {formatStamp(m.createdAt)}
                      </time>
                    </div>
                  )}
                  <div className="msg__text">{m.content}</div>
                </div>
              </article>
            </Fragment>
          )
        })}
      </div>

      <Composer key={channel?.id} {...props} />

      <div className={`typing${typingNames.length ? ' is-visible' : ''}`}>
        {typingNames.length > 0 && (
          <>
            <span className="typing__dots">
              <i />
              <i />
              <i />
            </span>
            <span className="truncate">
              <b>{typingNames.slice(0, 3).join(', ')}</b> {typingNames.length > 1 ? 'печатают…' : 'печатает…'}
            </span>
          </>
        )}
      </div>
    </section>
  )
}

function Composer({ channel, onSend, onTyping }: Props) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const send = async () => {
    const content = value.trim()
    if (!content || sending) return
    setSending(true)
    const ok = await onSend(content)
    setSending(false)
    if (ok) setValue('')
    ref.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="composer">
      <div className="composer__box">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          autoFocus
          placeholder={channel ? `Написать в #${channel.name}` : ''}
          disabled={!channel}
          onChange={(e) => {
            setValue(e.target.value)
            if (e.target.value) onTyping()
          }}
          onKeyDown={onKeyDown}
        />
        <button
          className={`composer__send${value.trim() ? ' is-ready' : ''}`}
          onClick={() => void send()}
          aria-label="Отправить"
          disabled={!value.trim() || sending}
        >
          <SendHorizontal size={20} />
        </button>
      </div>
    </div>
  )
}

function MessageSkeleton() {
  return (
    <div className="skeleton">
      {[0.6, 0.85, 0.4, 0.7].map((w, i) => (
        <div className="skeleton__row" key={i} style={{ animationDelay: `${i * 120}ms` }}>
          <span className="skeleton__avatar" />
          <div className="skeleton__lines">
            <span style={{ width: '18%' }} />
            <span style={{ width: `${w * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
