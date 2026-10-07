import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Hash, Headphones, HeadphoneOff, LogOut, Mic, MicOff, UserPlus, Volume2 } from 'lucide-react'
import type { Channel, Guild, User } from '../lib/api'
import { Avatar } from './Avatar'

interface Props {
  guild: Guild | null
  activeChannelId: string | null
  user: User
  onSelectChannel: (channel: Channel) => void
  onInvite: () => void
  onLogout: () => void
}

export function ChannelSidebar({ guild, activeChannelId, user, onSelectChannel, onInvite, onLogout }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [muted, setMuted] = useState(false)
  const [deafened, setDeafened] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])

  const text = guild?.channels.filter((c) => c.type === 'text') ?? []
  const voice = guild?.channels.filter((c) => c.type === 'voice') ?? []

  return (
    <aside className="sidebar">
      <div className="sidebar__header" ref={headerRef}>
        <button className={`sidebar__guild${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen((v) => !v)} disabled={!guild}>
          <span className="truncate">{guild?.name ?? '—'}</span>
          <ChevronDown size={18} className="sidebar__chevron" />
        </button>
        {menuOpen && (
          <div className="menu">
            <button
              className="menu__item"
              onClick={() => {
                setMenuOpen(false)
                onInvite()
              }}
            >
              Пригласить друзей <UserPlus size={16} />
            </button>
            <div className="menu__sep" />
            <button className="menu__item menu__item--danger" onClick={onLogout}>
              Выйти из аккаунта <LogOut size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="sidebar__channels" key={guild?.id}>
        <ChannelGroup title="Текстовые каналы">
          {text.map((c) => (
            <ChannelRow key={c.id} channel={c} active={c.id === activeChannelId} onClick={() => onSelectChannel(c)} />
          ))}
        </ChannelGroup>
        <ChannelGroup title="Голосовые каналы">
          {voice.map((c) => (
            <ChannelRow key={c.id} channel={c} active={false} onClick={() => onSelectChannel(c)} />
          ))}
        </ChannelGroup>
      </div>

      <div className="userbar">
        <div className="userbar__me">
          <Avatar user={user} size={34} status="online" />
          <div className="userbar__names">
            <span className="userbar__name truncate">{user.displayName}</span>
            <span className="userbar__tag truncate">@{user.username}</span>
          </div>
        </div>
        <div className="userbar__actions">
          <IconToggle on={muted} onClick={() => setMuted((v) => !v)} label={muted ? 'Включить микрофон' : 'Выключить микрофон'}>
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </IconToggle>
          <IconToggle on={deafened} onClick={() => setDeafened((v) => !v)} label={deafened ? 'Включить звук' : 'Выключить звук'}>
            {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
          </IconToggle>
          <button className="icon-btn" onClick={onLogout} aria-label="Выйти" data-tip="Выйти">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function ChannelGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className={`chgroup${open ? '' : ' is-collapsed'}`}>
      <button className="chgroup__title" onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={12} className="chgroup__chevron" />
        {title}
      </button>
      <div className="chgroup__list">
        <div>{children}</div>
      </div>
    </section>
  )
}

function ChannelRow({ channel, active, onClick }: { channel: Channel; active: boolean; onClick: () => void }) {
  return (
    <button className={`channel${active ? ' is-active' : ''}`} onClick={onClick}>
      {channel.type === 'text' ? <Hash size={18} /> : <Volume2 size={18} />}
      <span className="truncate">{channel.name}</span>
    </button>
  )
}

function IconToggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button className={`icon-btn${on ? ' is-on' : ''}`} onClick={onClick} aria-label={label} aria-pressed={on} data-tip={label}>
      {children}
    </button>
  )
}
