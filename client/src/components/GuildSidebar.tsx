import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, UserPlus, Volume2 } from 'lucide-react'
import type { Channel } from '../lib/api'
import { isOnline } from '../lib/status'
import { activeChannelId, chat, useChat } from '../lib/store'
import { ui } from '../lib/ui'
import { UserBar } from './UserBar'

export function GuildSidebar({ guildId, onLogout }: { guildId: string; onLogout: () => void }) {
  const guild = useChat((s) => s.guilds.find((g) => g.id === guildId))
  const activeId = useChat((s) => activeChannelId(s))
  const unread = useChat((s) => s.unread)
  const presence = useChat((s) => s.presence)
  const meId = useChat((s) => s.me?.id)
  const [menuOpen, setMenuOpen] = useState(false)
  const headRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => !headRef.current?.contains(e.target as Node) && setMenuOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])

  if (!guild) return <aside className="side panel" />

  const online = guild.members.filter((m) => m.id === meId || isOnline(presence[m.id])).length
  const text = guild.channels.filter((c) => c.type === 'text')
  const voice = guild.channels.filter((c) => c.type === 'voice')

  const open = (c: Channel) => {
    if (c.type === 'voice') {
      chat.toast({ title: 'Голосовые каналы', text: 'Скоро — это следующий большой этап 🎧' })
      return
    }
    chat.openGuildChannel(guild.id, c.id)
  }

  return (
    <aside className="side panel glow" key={guild.id}>
      <header className="side__head side__head--button" ref={headRef}>
        <button className={`side__guild${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen((v) => !v)}>
          <span className="side__title truncate">{guild.name}</span>
          <ChevronDown size={18} className="side__chevron" />
        </button>
        <span className="side__meta">
          <i className="live-dot" /> {online} в сети · {guild.members.length} всего
        </span>
        {menuOpen && (
          <div className="menu">
            <button
              className="menu__item"
              onClick={() => {
                setMenuOpen(false)
                ui.openModal('invite')
              }}
            >
              Пригласить друзей <UserPlus size={16} />
            </button>
            <button
              className="menu__item"
              onClick={() => {
                setMenuOpen(false)
                void navigator.clipboard?.writeText(guild.id).then(() => chat.toast({ title: 'Код скопирован', text: 'Отправь его другу' }))
              }}
            >
              Скопировать код <Copy size={16} />
            </button>
          </div>
        )}
      </header>

      <div className="side__scroll">
        <ChannelGroup title="Текстовые каналы">
          {text.map((c) => {
            const count = unread[c.id] ?? 0
            return (
              <button key={c.id} className={`channel${c.id === activeId ? ' is-active' : ''}${count ? ' has-unread' : ''}`} onClick={() => open(c)}>
                <span className="channel__glyph">#</span>
                <span className="truncate">{c.name}</span>
                {count > 0 && c.id !== activeId && <span className="channel__dot" />}
              </button>
            )
          })}
        </ChannelGroup>
        <ChannelGroup title="Голосовые каналы">
          {voice.map((c) => (
            <button key={c.id} className="channel channel--voice" onClick={() => open(c)}>
              <Volume2 size={16} className="channel__glyph" />
              <span className="truncate">{c.name}</span>
              <span className="channel__soon">скоро</span>
            </button>
          ))}
        </ChannelGroup>
      </div>

      <UserBar onLogout={onLogout} />
    </aside>
  )
}

function ChannelGroup({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className={`chgroup${open ? '' : ' is-collapsed'}`}>
      <button className="side__label side__label--button" onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={12} className="chgroup__chevron" />
        <span>{title}</span>
      </button>
      <div className="chgroup__list">
        <div>{children}</div>
      </div>
    </section>
  )
}
