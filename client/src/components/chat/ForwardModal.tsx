import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CornerUpRight, Search } from 'lucide-react'
import { SYSTEM_AUTHOR, type Message } from '../../lib/api'
import { MEMBERS, plural } from '../../lib/format'
import { findLoaded, msgUi, useMsgUi } from '../../lib/msgActions'
import { can } from '../../lib/perms'
import { forwardMessage } from '../../lib/realtime'
import { chat, dmTitle, useChat, type View } from '../../lib/store'
import { Avatar } from '../Avatar'
import { GroupAvatar } from '../groups/GroupAvatar'
import { Modal } from '../Modal'

/** Куда можно переслать: личка, группа или текстовый канал сервера */
interface Target {
  id: string
  kind: 'dm' | 'group' | 'channel'
  title: string
  sub: string
  userId?: string
  memberIds?: string[]
}

/** «Переслать…»: поиск по личкам, группам и каналам, где можно писать */
export function ForwardModal() {
  const fwd = useMsgUi((s) => s.forward)
  const message = useChat((s) => (fwd ? findLoaded(s, fwd.channelId, fwd.messageId) : undefined))

  // Сообщение удалили, пока выбирали, — пересылать нечего
  const gone = fwd !== null && !message
  useEffect(() => {
    if (gone) msgUi.closeForward()
  }, [gone])

  if (!fwd || !message) return null
  return <ForwardPicker key={message.id} message={message} />
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

function ForwardPicker({ message }: { message: Message }) {
  const dms = useChat((s) => s.dms)
  const guilds = useChat((s) => s.guilds)
  const users = useChat((s) => s.users)
  const me = useChat((s) => s.me)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Пересылают пересланное — автор и так указан в оригинале
  const authorId = message.forwarded?.authorId ?? message.authorId
  const author = useChat((s) => s.users[authorId])

  const targets = useMemo(() => {
    const st = useChat.getState()
    const out: Target[] = []
    for (const d of [...dms].sort((a, b) => b.lastMessageAt - a.lastMessageAt)) {
      if (d.kind === 'dm') {
        const u = d.userId ? users[d.userId] : undefined
        if (u) out.push({ id: d.id, kind: 'dm', title: u.displayName, sub: `@${u.username}`, userId: u.id })
      } else {
        out.push({ id: d.id, kind: 'group', title: dmTitle(st, d), sub: plural(d.memberIds.length, MEMBERS), memberIds: d.memberIds })
      }
    }
    // каналы серверов — только текстовые и только те, где у меня есть право писать
    for (const g of guilds) {
      for (const c of g.channels) {
        if (c.type === 'text' && can(g, 'SEND_MESSAGES', c.id)) out.push({ id: c.id, kind: 'channel', title: c.name, sub: g.name })
      }
    }
    return out
  }, [dms, guilds, users, me])

  const q = query.trim().toLowerCase()
  const shown = q ? targets.filter((t) => `${t.title} ${t.sub}`.toLowerCase().includes(q)) : targets
  const active = Math.min(sel, Math.max(0, shown.length - 1))

  // Выбранная строка — всегда в поле зрения
  useEffect(() => {
    listRef.current?.querySelector('.fwd-target.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [active, q])

  const send = async (t: Target) => {
    if (busy) return
    setBusy(t.id)
    const sent = await forwardMessage(message.id, t.id)
    setBusy(null)
    if (!sent) return
    msgUi.closeForward()
    const where = t.kind === 'channel' ? `#${t.title}` : t.kind === 'group' ? `«${t.title}»` : t.title
    const action: View | undefined = t.kind === 'channel' ? undefined : { kind: 'dm', dmId: t.id }
    chat.toast({ title: `Переслано в ${where}`, text: oneLine(message.content).slice(0, 120), action })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!shown.length) return
      setSel((active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length)
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && shown[active]) {
      e.preventDefault()
      void send(shown[active])
    }
  }

  const authorName = message.authorId === SYSTEM_AUTHOR ? 'Nuntius' : (author?.displayName ?? 'Неизвестный')
  const firstChannel = shown.findIndex((t) => t.kind === 'channel')

  return (
    <Modal title="Переслать сообщение" subtitle="Выбери, куда — оно уйдёт с пометкой «Переслано» и именем автора." onClose={msgUi.closeForward}>
      <div className="fwd-modal">
        <div className="fwd-preview">
          <CornerUpRight size={15} className="fwd-preview__icon" />
          {author && <Avatar user={author} size={20} />}
          <b className="fwd-preview__name">{authorName}</b>
          <span className="fwd-preview__text truncate">{oneLine(message.content)}</span>
        </div>
        <div className="picker__search">
          <Search size={16} />
          <input
            value={query}
            autoFocus
            placeholder="Найти чат, группу или канал"
            aria-label="Найти, куда переслать"
            onChange={(e) => {
              setQuery(e.target.value)
              setSel(0)
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="picker__list fwd-modal__list" ref={listRef} role="listbox" aria-label="Куда переслать">
          {shown.length === 0 && <p className="muted picker__empty">{targets.length ? 'Ничего не нашли' : 'Пока некуда пересылать'}</p>}
          {shown.map((t, i) => (
            <div key={t.id} className="fwd-modal__row">
              {i === 0 && t.kind !== 'channel' && <div className="label fwd-modal__head">Личные и группы</div>}
              {i === firstChannel && <div className="label fwd-modal__head">Каналы серверов</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`picker__item fwd-target${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => void send(t)}
                disabled={busy !== null}
              >
                {t.kind === 'dm' && t.userId && users[t.userId] ? (
                  <Avatar user={users[t.userId]} size={32} />
                ) : t.kind === 'group' && t.memberIds ? (
                  <GroupAvatar memberIds={t.memberIds} size={32} />
                ) : (
                  <span className="fwd-target__hash">#</span>
                )}
                <span className="picker__name">
                  <b className="truncate">{t.title}</b>
                  <span className="truncate">{t.sub}</span>
                </span>
                <span className="fwd-target__go">{busy === t.id ? 'Пересылаем…' : 'Переслать'}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
