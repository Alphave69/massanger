import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUp, Lock, PanelRight, Phone, UserPlus, Users, Video } from 'lucide-react'
import { api, SYSTEM_AUTHOR, type Message, type MessageFlavor, type User, type VoiceMember } from '../lib/api'
import { findEgg, introClick, isAprilFools, isWishTime } from '../lib/eggs'
import { formatDay, formatStamp, formatTime, MEMBERS, plural, sameDay } from '../lib/format'
import { can, roleColor } from '../lib/perms'
import { sendMessage, sendTyping } from '../lib/realtime'
import { STATUS_LABEL } from '../lib/status'
import { activeChannelId, chat, dmTitle, presenceOf, useChat } from '../lib/store'
import { ui, useUi } from '../lib/ui'
import { joinVoice, toggleCamera, useVoice } from '../lib/voice'
import { Avatar } from './Avatar'
import { UserTags } from './UserTags'
import { GroupAvatar } from './groups/GroupAvatar'
import { MessageActions } from './guild/MessageActions'
import { VoiceStage } from './voice/VoiceStage'

const GROUP_WINDOW = 7 * 60 * 1000
const UNKNOWN: User = { id: 'unknown', username: 'unknown', displayName: 'Неизвестный', customStatus: '', bio: '', createdAt: 0, verified: false, number: 0, badges: [] }
const NO_MEMBERS: VoiceMember[] = []
/** Столько секунд «печатает…» без перерыва — уже не сообщение, а поэма (пасхалка) */
const POEM_AFTER = 40_000

/** Подписи у результатов команд */
const CMD_LABEL: Record<Exclude<MessageFlavor, 'me'>, string> = { roll: '/roll', flip: '/flip', ball: '/8ball' }

interface Command {
  name: string
  args?: string
  hint: string
}

/** Команды, которые понимает сервер (подсказка над полем ввода) */
const COMMANDS: Command[] = [
  { name: 'roll', args: '[N | NdM]', hint: 'Бросить кубик: d6, /roll 20 или /roll 2d6' },
  { name: 'flip', hint: 'Подбросить монетку — орёл или решка' },
  { name: '8ball', args: 'вопрос', hint: 'Спросить магический шар' },
  { name: 'me', args: 'действие', hint: 'Написать о себе в третьем лице' },
  { name: 'shrug', args: '[текст]', hint: 'Пожать плечами ¯\\_(ツ)_/¯' },
  { name: 'tableflip', args: '[текст]', hint: 'Перевернуть стол (╯°□°)╯︵ ┻━┻' },
  { name: 'unflip', hint: 'Поставить стол на место ┬─┬ ノ( ゜-゜ノ)' },
  { name: 'lenny', hint: 'Загадочное лицо ( ͡° ͜ʖ ͡°)' },
]

/** Позвонить в личку/группу (или зайти в уже идущий звонок), по желанию — сразу с камерой */
async function startCall(roomId: string, video: boolean) {
  await joinVoice(roomId)
  if (video && !useVoice.getState().localCamera) void toggleCamera()
}

export function ChatView() {
  const view = useChat((s) => s.view)
  const channelId = useChat((s) => activeChannelId(s))
  const guild = useChat((s) => (s.view.kind === 'guild' ? s.guilds.find((g) => g.id === (s.view as { guildId: string }).guildId) : undefined))
  const dm = useChat((s) => (s.view.kind === 'dm' ? s.dms.find((d) => d.id === (s.view as { dmId: string }).dmId) : undefined))
  const dmUser = useChat((s) => (dm?.userId ? s.users[dm.userId] : undefined))
  const dmStatus = useChat((s) => (dm?.userId ? presenceOf(s, dm.userId) : 'offline'))
  const group = dm?.kind === 'group' ? dm : undefined
  const groupTitle = useChat((s) => (group ? dmTitle(s, group) : ''))
  const callMembers = useVoice((s) => (dm ? (s.rooms[dm.id] ?? NO_MEMBERS) : NO_MEMBERS))
  const inCall = useVoice((s) => Boolean(dm) && s.roomId === dm?.id)
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

  if (!channelId || (view.kind === 'guild' && !channel) || (view.kind === 'dm' && !dmUser && !group)) {
    return <section className="main panel" />
  }

  const placeholder = group ? `Написать в «${groupTitle}»` : dmUser ? `Написать @${dmUser.username}` : `Написать в #${channel!.name}`
  const typers = typingIds.filter((id) => id !== meId)
  const groups = groupMessages(messages ?? [])
  // На сервере писать можно не везде — без права SEND_MESSAGES вместо поля ввода плашка
  const canSend = !guild || can(guild, 'SEND_MESSAGES', channelId)
  const april = isAprilFools()

  return (
    <section className="main panel glow chat">
      <header className="main__head">
        {group ? (
          <div className="main__title">
            <GroupAvatar memberIds={group.memberIds} size={30} />
            <h2 className="truncate">{groupTitle}</h2>
            <span className="main__sub">{plural(group.memberIds.length, MEMBERS)}</span>
          </div>
        ) : dmUser ? (
          <button className="main__title main__title--user" onClick={(e) => ui.showProfile(dmUser.id, e.currentTarget)}>
            <Avatar user={dmUser} size={30} status={dmStatus} />
            <h2>{dmUser.displayName}</h2>
            <UserTags user={dmUser} size={16} />
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
          {dm && !inCall && (
            <>
              <button className="icon-btn" onClick={() => void startCall(dm.id, false)} data-tip={callMembers.length ? 'Присоединиться к звонку' : 'Голосовой звонок'}>
                <Phone size={19} />
              </button>
              <button className="icon-btn" onClick={() => void startCall(dm.id, true)} data-tip="Видеозвонок">
                <Video size={19} />
              </button>
            </>
          )}
          {group && (
            <button className="icon-btn" onClick={() => ui.openGroupModal({ mode: 'add', dmId: group.id })} data-tip="Добавить друзей">
              <UserPlus size={19} />
            </button>
          )}
          <button className={`icon-btn${asideOpen ? ' is-active' : ''}`} onClick={ui.toggleAside} data-tip={dmUser ? 'Профиль' : 'Участники'}>
            {dmUser ? <PanelRight size={19} /> : <Users size={19} />}
          </button>
        </div>
      </header>

      {dm && inCall && <VoiceStage roomId={dm.id} variant="call" />}
      {dm && !inCall && callMembers.length > 0 && <CallBanner members={callMembers} onJoin={() => void startCall(dm.id, false)} />}

      <div className="main__scroll chat__scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat__spacer" />

        {group ? (
          <Welcome
            key={channelId}
            channelId={channelId}
            visual={<GroupAvatar memberIds={group.memberIds} size={84} />}
            title={groupTitle}
            text={
              april ? (
                <>
                  Это конец группы <b>{groupTitle}</b>… Шутка, с 1 апреля ✦ Это только начало — переписывайтесь и созванивайтесь всем вместе.
                </>
              ) : (
                <>
                  Это начало группы <b>{groupTitle}</b>. Здесь можно переписываться и созваниваться всем вместе.
                </>
              )
            }
          />
        ) : dmUser ? (
          <Welcome
            key={channelId}
            channelId={channelId}
            visual={<Avatar user={dmUser} size={84} status={dmStatus} ring />}
            title={
              <>
                {dmUser.displayName} <UserTags user={dmUser} size={22} />
              </>
            }
            tag={`@${dmUser.username}`}
            text={
              april ? (
                <>
                  Это конец вашей личной переписки с <b>{dmUser.displayName}</b>… Шутка, с 1 апреля ✦ Только вы двое — и это только начало.
                </>
              ) : (
                <>
                  Это начало вашей личной переписки с <b>{dmUser.displayName}</b>. Только вы двое.
                </>
              )
            }
          />
        ) : (
          <Welcome
            key={channelId}
            channelId={channelId}
            visual={<span className="welcome__hash">#</span>}
            title={`Добро пожаловать в #${channel!.name}!`}
            text={
              april
                ? `Это конец канала #${channel!.name}. Дальше ничего нет… Шутка, с 1 апреля ✦ Напиши что-нибудь первым.`
                : `Это начало канала #${channel!.name}. Напиши что-нибудь первым.`
            }
          />
        )}

        {messages === undefined && <MessageSkeleton />}

        {groups.map((g) => {
          if (g.authorId === SYSTEM_AUTHOR) {
            return (
              <Fragment key={g.messages[0].id}>
                {g.newDay && (
                  <div className="divider">
                    <span>{formatDay(g.messages[0].createdAt)}</span>
                  </div>
                )}
                {g.messages.map((m) => (
                  <div key={m.id} className={`sysmsg${known && !known.has(m.id) ? ' sysmsg--fresh' : ''}`}>
                    <span className="sysmsg__text">{m.content}</span>
                    <time>{formatTime(m.createdAt)}</time>
                    {isWishTime(m.createdAt) && <Wish />}
                    <MessageActions message={m} />
                  </div>
                ))}
              </Fragment>
            )
          }
          const mine = g.authorId === meId
          const author = users[g.authorId] ?? UNKNOWN
          // цвет имени — цвет высшей цветной роли на сервере
          const color = guild ? roleColor(guild, g.authorId) : null
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
                      <button
                        className={`mgroup__author${color ? ' has-color' : ''}`}
                        style={color ? { color } : undefined}
                        onClick={(e) => ui.showProfile(author.id, e.currentTarget)}
                      >
                        {author.displayName}
                      </button>
                      <UserTags user={author} />
                      <time>{formatStamp(g.messages[0].createdAt)}</time>
                    </div>
                  )}
                  {g.messages.map((m) => (
                    <Bubble key={m.id} message={m} fresh={Boolean(known && !known.has(m.id))} name={author.displayName} color={color} />
                  ))}
                </div>
              </div>
            </Fragment>
          )
        })}
      </div>

      {canSend ? (
        <Composer key={channelId} channelId={channelId} placeholder={placeholder} />
      ) : (
        <div className="composer">
          <div className="composer__locked">
            <Lock size={15} />
            <span className="truncate">
              У тебя нет прав писать в <b>#{channel?.name}</b>
            </span>
          </div>
        </div>
      )}

      <TypingBar key={`typing:${channelId}`} ids={typers} />
    </section>
  )
}

/** Плашка «идёт звонок» — если звонят без нас */
function CallBanner({ members, onJoin }: { members: VoiceMember[]; onJoin: () => void }) {
  const users = useChat((s) => s.users)
  return (
    <div className="call-banner">
      <span className="call-banner__pulse" />
      <div className="call-banner__avatars">
        {members.slice(0, 4).map((m) => users[m.userId] && <Avatar key={m.userId} user={users[m.userId]} size={26} />)}
      </div>
      <span className="call-banner__text">
        <b>Идёт звонок</b> · {plural(members.length, MEMBERS)}
      </span>
      <button className="btn btn--primary btn--sm" onClick={onJoin}>
        <Phone size={15} /> Присоединиться
      </button>
    </div>
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

/** Начало чата. Три клика по заголовку или тексту — спрятанная строка (пасхалка «Начало начал») */
function Welcome({ channelId, visual, title, tag, text }: { channelId: string; visual: ReactNode; title: ReactNode; tag?: string; text: ReactNode }) {
  const [secret, setSecret] = useState(false)
  const click = () => {
    if (introClick(channelId)) setSecret(true)
  }
  return (
    <div className="welcome">
      {visual}
      <h3 onClick={click}>{title}</h3>
      {tag && <span className="welcome__tag">{tag}</span>}
      <p onClick={click}>{text}</p>
      {secret && <p className="welcome__secret">…а где-то там, далеко, — его конец</p>}
    </div>
  )
}

/** Звёздочка у времени 11:11 и 22:22 */
function Wish() {
  return (
    <span className="wish" data-tip="Загадай желание" aria-label="Загадай желание">
      ✦
    </span>
  )
}

/** Одно сообщение: обычное, «/me» (курсивом от третьего лица) или результат команды */
function Bubble({ message: m, fresh, name, color }: { message: Message; fresh: boolean; name: string; color: string | null }) {
  const flavor = m.flavor
  const kind = flavor === 'me' ? ' bubble--me' : flavor ? ' bubble--cmd' : ''
  return (
    <div className={`bubble${kind}${fresh ? ' bubble--fresh' : ''}`}>
      {flavor && flavor !== 'me' && <span className="bubble__cmd">{CMD_LABEL[flavor] ?? '/'}</span>}
      <span className="bubble__text">
        {flavor === 'me' && (
          <>
            <b style={color ? { color } : undefined}>{name}</b>{' '}
          </>
        )}
        {m.content}
      </span>
      <time className="bubble__time" title={formatStamp(m.createdAt)}>
        {formatTime(m.createdAt)}
      </time>
      {isWishTime(m.createdAt) && <Wish />}
      <MessageActions message={m} />
    </div>
  )
}

/** «печатает…»; кто печатает без перерыва 40 секунд — «пишет поэму…» */
function TypingBar({ ids }: { ids: string[] }) {
  const users = useChat((s) => s.users)
  const since = useRef(new Map<string, number>())
  const [, tick] = useState(0)

  // Запоминаем, с какого момента человек печатает (ушёл больше чем на пару секунд — отсчёт заново)
  const now = Date.now()
  const map = since.current
  for (const id of ids) if (!map.has(id)) map.set(id, now)
  for (const id of map.keys()) if (!ids.includes(id)) map.delete(id)
  const poets = ids.filter((id) => now - (map.get(id) ?? now) >= POEM_AFTER)
  const hasPoet = poets.length > 0

  // Перерисоваться ровно тогда, когда кто-то «дописал до поэмы»
  useEffect(() => {
    const waiting = ids.filter((id) => !poets.includes(id))
    if (!waiting.length) return
    const next = Math.min(...waiting.map((id) => (map.get(id) ?? Date.now()) + POEM_AFTER)) - Date.now()
    const timer = window.setTimeout(() => tick((n) => n + 1), Math.max(0, next) + 50)
    return () => window.clearTimeout(timer)
  })

  useEffect(() => {
    if (hasPoet) findEgg('poem')
  }, [hasPoet])

  const names = ids.map((id) => users[id]?.displayName ?? '…')
  const verb =
    ids.length === 1 ? (hasPoet ? 'пишет поэму…' : 'печатает…') : poets.length === ids.length ? 'пишут поэму…' : 'печатают…'

  return (
    <div className={`typing${ids.length ? ' is-visible' : ''}${hasPoet ? ' is-poem' : ''}`}>
      {ids.length > 0 && (
        <>
          <span className="typing__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="truncate">
            <b>{names.slice(0, 3).join(', ')}</b> {verb}
          </span>
        </>
      )}
    </div>
  )
}

function Composer({ channelId, placeholder }: { channelId: string; placeholder: string }) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [burst, setBurst] = useState(0)
  // подсказка команд: закрыли по Esc — не показываем, пока не сотрут «/»
  const [hintsClosed, setHintsClosed] = useState(false)
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  // Пока набирают первое слово после «/», подсказываем команды
  const query = /^\/(\S*)$/.exec(value)?.[1]?.toLowerCase()
  const matches = query === undefined || hintsClosed ? [] : COMMANDS.filter((c) => c.name.startsWith(query))
  const active = Math.min(sel, Math.max(0, matches.length - 1))

  const complete = (c: Command) => {
    setValue(`/${c.name} `)
    setSel(0)
    ref.current?.focus()
  }

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
    if (matches.length > 0 && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setSel((active + step + matches.length) % matches.length)
        return
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault()
        complete(matches[active])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setHintsClosed(true)
        return
      }
      // Enter на недописанной команде («/fl») — дописывает её, на полной — отправляет
      if (e.key === 'Enter' && !e.shiftKey && matches[active].name !== query) {
        e.preventDefault()
        complete(matches[active])
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  const ready = value.trim().length > 0

  return (
    <div className="composer">
      {matches.length > 0 && (
        <div className="cmd-hints" role="listbox" aria-label="Команды">
          <div className="cmd-hints__head">Команды</div>
          {matches.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`cmd-hint${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSel(i)}
              onClick={() => complete(c)}
            >
              <span className="cmd-hint__name">
                /{c.name}
                {c.args && <span className="cmd-hint__args"> {c.args}</span>}
              </span>
              <span className="cmd-hint__desc truncate">{c.hint}</span>
            </button>
          ))}
          <div className="cmd-hints__keys">
            <kbd>↑</kbd>
            <kbd>↓</kbd> выбрать · <kbd>Tab</kbd> дописать · <kbd>Esc</kbd> закрыть
          </div>
        </div>
      )}
      <div className="composer__box glow">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          autoFocus
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={matches.length > 0}
          onChange={(e) => {
            const v = e.target.value
            setValue(v)
            setSel(0)
            if (!v.startsWith('/')) setHintsClosed(false)
            if (v) sendTyping(channelId)
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
