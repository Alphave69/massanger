import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react'
import type { Guild, Message, User } from '../../lib/api'
import { richParts, shortLink, type RichPart } from '../../lib/linkify'
import { splitMentions } from '../../lib/mentions'
import { guildOfChannel } from '../../lib/perms'
import { useChat } from '../../lib/store'
import { ui } from '../../lib/ui'

/**
 * Текст сообщения: ссылки — подсвеченными и кликабельными (в новой вкладке, в приложении — в браузере),
 * `код` и ```блоки``` — моноширинным, упоминания — «плашками» (@Имя, @Роль цветом роли, @everyone).
 * Клик по человеку — его карточка. Неподтверждённые сервером метки — обычным текстом.
 */
export function MentionText({ message: m }: { message: Message }) {
  const parts = useMemo(() => richParts(m.content), [m.content])
  // без «@» упоминаний нет — и подписываться на людей и роли незачем
  if (!m.content.includes('@')) return <Parts parts={parts} />
  return <WithMentions message={m} parts={parts} />
}

function WithMentions({ message: m, parts }: { message: Message; parts: RichPart[] }) {
  const users = useChat((s) => s.users)
  const meId = useChat((s) => s.me?.id)
  const guild = useChat((s) => guildOfChannel(s.guilds, m.channelId))
  return <Parts parts={parts} renderText={(text) => <Mentions text={text} message={m} users={users} meId={meId} guild={guild} />} />
}

function Parts({ parts, renderText }: { parts: RichPart[]; renderText?: (text: string) => ReactNode }) {
  // обычное сообщение без ссылок и кода — просто строка
  if (parts.length === 1 && parts[0].kind === 'text' && !renderText) return <>{parts[0].text}</>
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'link') {
          const short = shortLink(p.text)
          return (
            <a
              key={i}
              className="msg-link"
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              title={short !== p.text ? p.text : undefined}
              // клик по ссылке — только переход, без меню сообщения и прочего
              onClick={(e) => e.stopPropagation()}
            >
              {short}
            </a>
          )
        }
        if (p.kind === 'code') {
          return p.block ? (
            <pre key={i} className="msg-pre">
              <code>{p.text}</code>
            </pre>
          ) : (
            <code key={i} className="msg-code">
              {p.text}
            </code>
          )
        }
        return <Fragment key={i}>{renderText ? renderText(p.text) : p.text}</Fragment>
      })}
    </>
  )
}

interface MentionProps {
  text: string
  message: Message
  users: Record<string, User>
  meId: string | undefined
  guild: Guild | undefined
}

function Mentions({ text, message: m, users, meId, guild }: MentionProps) {
  if (!text.includes('@')) return <>{text}</>
  const ok = m.mentions
  const myRoles = (meId && guild?.memberRoles?.[meId]) || []
  return (
    <>
      {splitMentions(text).map((p, i) => {
        if (p.kind === 'text') return <Fragment key={i}>{p.text}</Fragment>
        if (p.kind === 'user') {
          const user = users[p.id]
          if (!user) return <Fragment key={i}>{p.raw}</Fragment>
          if (!ok?.users.includes(p.id)) return <Fragment key={i}>@{user.username}</Fragment>
          return (
            <button
              key={i}
              type="button"
              className={`mention${p.id === meId ? ' is-me' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                ui.showProfile(user.id, e.currentTarget)
              }}
            >
              @{user.displayName}
            </button>
          )
        }
        if (p.kind === 'role') {
          const role = guild?.roles?.find((r) => r.id === p.id)
          if (!role) return <Fragment key={i}>{p.raw}</Fragment>
          if (!ok?.roles.includes(p.id)) return <Fragment key={i}>@{role.name}</Fragment>
          const style = role.color ? ({ '--mention': role.color } as CSSProperties) : undefined
          return (
            <span key={i} className={`mention mention--role${role.color ? ' has-color' : ''}${myRoles.includes(role.id) ? ' is-me' : ''}`} style={style}>
              @{role.name}
            </span>
          )
        }
        const live = p.which === 'everyone' ? ok?.everyone : Boolean(ok?.here)
        if (!live) return <Fragment key={i}>{p.raw}</Fragment>
        return (
          <span key={i} className="mention mention--mass is-me">
            @{p.which}
          </span>
        )
      })}
    </>
  )
}
