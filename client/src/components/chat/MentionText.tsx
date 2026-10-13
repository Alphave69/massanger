import { useMemo, type CSSProperties } from 'react'
import type { Message } from '../../lib/api'
import { splitMentions } from '../../lib/mentions'
import { guildOfChannel } from '../../lib/perms'
import { useChat } from '../../lib/store'
import { ui } from '../../lib/ui'

/**
 * Текст сообщения с упоминаниями: подтверждённые сервером — «плашками» (@Имя, @Роль цветом роли, @everyone),
 * клик по человеку — его карточка. Неподтверждённые метки — обычным текстом.
 */
export function MentionText({ message: m }: { message: Message }) {
  // без «@» в тексте упоминаний нет — и подписываться на людей и роли незачем
  return m.content.includes('@') ? <Rich message={m} /> : <>{m.content}</>
}

function Rich({ message: m }: { message: Message }) {
  const pieces = useMemo(() => splitMentions(m.content), [m.content])
  const users = useChat((s) => s.users)
  const meId = useChat((s) => s.me?.id)
  const guild = useChat((s) => guildOfChannel(s.guilds, m.channelId))

  const ok = m.mentions
  const myRoles = (meId && guild?.memberRoles?.[meId]) || []
  return (
    <>
      {pieces.map((p, i) => {
        if (p.kind === 'text') return p.text
        if (p.kind === 'user') {
          const user = users[p.id]
          if (!user) return p.raw
          if (!ok?.users.includes(p.id)) return `@${user.username}`
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
          if (!role) return p.raw
          if (!ok?.roles.includes(p.id)) return `@${role.name}`
          const style = role.color ? ({ '--mention': role.color } as CSSProperties) : undefined
          return (
            <span key={i} className={`mention mention--role${role.color ? ' has-color' : ''}${myRoles.includes(role.id) ? ' is-me' : ''}`} style={style}>
              @{role.name}
            </span>
          )
        }
        const live = p.which === 'everyone' ? ok?.everyone : Boolean(ok?.here)
        if (!live) return p.raw
        return (
          <span key={i} className="mention mention--mass is-me">
            @{p.which}
          </span>
        )
      })}
    </>
  )
}
