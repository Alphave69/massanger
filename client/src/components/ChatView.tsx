import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUp, PanelRight, Users } from 'lucide-react'
import { api, type Message, type User } from '../lib/api'
import { formatDay, formatStamp, formatTime, sameDay } from '../lib/format'
import { sendMessage, sendTyping } from '../lib/realtime'
import { STATUS_LABEL } from '../lib/status'
import { activeChannelId, chat, presenceOf, useChat } from '../lib/store'
import { ui, useUi } from '../lib/ui'
import { Avatar } from './Avatar'

const GROUP_WINDOW = 7 * 60 * 1000
const UNKNOWN: User = { id: 'unknown', username: 'unknown', displayName: 'Неизвестный', customStatus: '', createdAt: 0 }

export function ChatView() {
  const view = useChat((s) => s.view)
  const channelId = useChat((s) => activeChannelId(s))
  const guild = useChat((s) => (s.view.kind === 'guild' ? s.guilds.find((g) => g.id === (s.view as { guildId: string }).guildId) : undefined))
  const dm = useChat((s) => (s.view.kind === 'dm' ? s.dms.find((d) => d.id === (s.view as { dmId: string }).dmId) : undefined))
  const dmUser = useChat((s) => (dm ? s.users[dm.userId] : undefined))
  const dmStatus = useChat((s) => (dm ? presenceOf(s, dm.userId) : 'offline'))
  const messages = useChat((s) => (channelId ? s.messages[channelId] : undefined))
  const users = useChat((s) => s.users)
  const meId = useChat((s) => s.me!.id)
  const typingIds = useChat(useShallow((s) => (channelId ? Object.keys(s.typing[channelId] ?? {}) : [])))
  const asideOpen = useUi((s) => s.asideOpen)

  const channel = guild?.channels.find((c) => c.id === channelId)

  // История канала — при первом открытии
  useEffect(() => {
    if (!channelId || messages) return
    api
      .messages(channelId)
      .then(({ messages: list }) => chat.setMessages(channelId, list))
      .catch(() => chat.toast({ title: 'Ошибка', text: 'Не удалось загрузить сообщения' }))
  }, [channelId, messages])

  // --- прокрутка и анимация только новых сообщений ---
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const baseline = useRef<{ channelId: string | null; ids: Set<string> | null }>({ channelId: null, ids: null })
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
    if (stickToBottom.current || last?.authorId === meId) el.scrollTo({ top: el.scrollHeight, behavior: known && known.size < messages.length ? 'smooth' : 'auto' })
  }, [messages, meId, known])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  if (!channelId || (view.kind === 'guild' && !channel) || (view.kind === 'dm' && !dmUser)) {
    return <section className="main panel" />
  }

  const placeholder = dmUser ? `Написать @${dmUser.username}` : `Написать в #${channel!.name}`
  const typingNames = typingIds.filter((id) => id !== meId).map((id) => users[id]?.displayName ?? '…')
  const groups = groupMessages(messages ?? [])

  return (
    <section className="main panel glow chat">
      <header className="main__head">
        {dmUser ? (
          <button className="main__title main__title--user" onClick={(e) => ui.showProfile(dmUser.id, e.currentTarget)}>
            <Avatar user={dmUser} size={30} status={dmStatus} />
            <h2>{dmUser.displayName}</h2>
            <span className="main__sub">{dmUser.customStatus || STATUS_LABEL[dmStatus]}</span>
          </button>
        ) : (
          <div className="main__title">
            <span className="hash-tile">#</span>
            <h2>{channel!.name}</h2>
            <span className="main__sub">текстовый канал · {guild!.name}</span>
          </div>
        )}
        <div className="main__actions">
          <button className={`icon-btn${asideOpen ? ' is-active' : ''}`} onClick={ui.toggleAside} data-tip={dmUser ? 'Профиль' : 'Участники'}>
            {dmUser ? <PanelRight size={19} /> : <Users size={19} />}
          </button>
        </div>
      </header>

      <div className="main__scroll chat__scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat__spacer" />

        {dmUser ? (
          <div className="welcome" key={channelId}>
            <Avatar user={dmUser} size={84} status={dmStatus} ring />
            <h3>{dmUser.displayName}</h3>
            <span className="welcome__tag">@{dmUser.username}</span>
            <p>
              Это начало вашей личной переписки с <b>{dmUser.displayName}</b>. Только вы двое.
            </p>
          </div>
        ) : (
          <div className="welcome" key={channelId}>
            <span className="welcome__hash">#</span>
            <h3>Добро пожаловать в #{channel!.name}!</h3>
            <p>Это начало канала #{channel!.name}. Напиши что-нибудь первым.</p>
          </div>
        )}

        {messages === undefined && <MessageSkeleton />}

        {groups.map((g) => {
          const mine = g.authorId === meId
          const author = users[g.authorId] ?? UNKNOWN
          return (
            <Fragment key={g.messages[0].id}>
              {g.newDay && (
                <div className="divider">
                  <span>{formatDay(g.messages[0].createdAt)}</span>
                </div>
              )}
              <div className={`mgroup${mine ? ' mgroup--mine' : ''}`}>
                {!mine && (
                  <button className="mgroup__avatar" onClick={(e) => ui.showProfile(author.id, e.currentTarget)}>
                    <Avatar user={author} size={38} />
                  </button>
                )}
                <div className="mgroup__body">
                  {!mine && (
                    <div className="mgroup__meta">
                      <button className="mgroup__author" onClick={(e) => ui.showProfile(author.id, e.currentTarget)}>
                        {author.displayName}
                      </button>
                      <time>{formatStamp(g.messages[0].createdAt)}</time>
                    </div>
                  )}
                  {g.messages.map((m) => (
                    <div key={m.id} className={`bubble${known && !known.has(m.id) ? ' bubble--fresh' : ''}`}>
                      <span className="bubble__text">{m.content}</span>
                      <time className="bubble__time" title={formatStamp(m.createdAt)}>
                        {formatTime(m.createdAt)}
                      </time>
                    </div>
                  ))}
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>

      <Composer key={channelId} channelId={channelId} placeholder={placeholder} />

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

interface Group {
  authorId: string
  newDay: boolean
  messages: Message[]
}

function groupMessages(list: Message[]): Group[] {
  const groups: Group[] = []
  let prev: Message | undefined
  for (const m of list) {
    const newDay = !prev || !sameDay(prev.createdAt, m.createdAt)
    const last = groups[groups.length - 1]
    if (last && !newDay && prev!.authorId === m.authorId && m.createdAt - prev!.createdAt < GROUP_WINDOW) {
      last.messages.push(m)
    } else {
      groups.push({ authorId: m.authorId, newDay, messages: [m] })
    }
    prev = m
  }
  return groups
}

function Composer({ channelId, placeholder }: { channelId: string; placeholder: string }) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [burst, setBurst] = useState(0)
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
    const ok = await sendMessage(channelId, content)
    setSending(false)
    if (ok) {
      setValue('')
      setBurst((n) => n + 1)
    }
    ref.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const ready = value.trim().length > 0

  return (
    <div className="composer">
      <div className="composer__box glow">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          autoFocus
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value)
            if (e.target.value) sendTyping(channelId)
          }}
          onKeyDown={onKeyDown}
        />
        <button className={`composer__send${ready ? ' is-ready' : ''}`} onClick={() => void send()} aria-label="Отправить" disabled={!ready || sending}>
          <ArrowUp size={19} strokeWidth={2.5} />
          {burst > 0 && <span key={burst} className="composer__ring" />}
        </button>
      </div>
    </div>
  )
}

function MessageSkeleton() {
  return (
    <div className="skeleton">
      {[0.5, 0.75, 0.35, 0.6].map((w, i) => (
        <div className={`skeleton__row${i % 2 ? ' skeleton__row--mine' : ''}`} key={i} style={{ animationDelay: `${i * 120}ms` }}>
          <span style={{ width: `${w * 100}%` }} />
        </div>
      ))}
    </div>
  )
}
