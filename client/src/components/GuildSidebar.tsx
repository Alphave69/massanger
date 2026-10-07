import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Copy, HeadphoneOff, LogOut, MicOff, MonitorUp, Plus, Settings, UserPlus, Video, Volume2 } from 'lucide-react'
import type { Channel, Guild, VoiceMember } from '../lib/api'
import { isOnline } from '../lib/status'
import { activeChannelId, chat, useChat } from '../lib/store'
import { ui } from '../lib/ui'
import { joinVoice, useVoice } from '../lib/voice'
import { Avatar } from './Avatar'
import { UserBar } from './UserBar'
import { VoicePanel } from './voice/VoicePanel'

const NO_MEMBERS: VoiceMember[] = []

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

  const isOwner = guild.ownerId === meId
  const online = guild.members.filter((m) => m.id === meId || isOnline(presence[m.id])).length
  const text = guild.channels.filter((c) => c.type === 'text')
  const voice = guild.channels.filter((c) => c.type === 'voice')

  const menu = (label: string, icon: ReactNode, action: () => void, danger = false) => (
    <button
      className={`menu__item${danger ? ' menu__item--danger' : ''}`}
      onClick={() => {
        setMenuOpen(false)
        action()
      }}
    >
      {label} {icon}
    </button>
  )

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
            {menu('Пригласить друзей', <UserPlus size={16} />, () => ui.openModal('invite'))}
            {menu('Скопировать код', <Copy size={16} />, () =>
              void navigator.clipboard?.writeText(guild.id).then(() => chat.toast({ title: 'Код скопирован', text: 'Отправь его другу' })),
            )}
            {isOwner && <div className="menu__sep" />}
            {isOwner && menu('Настройки сервера', <Settings size={16} />, () => ui.openServerSettings(guild.id))}
            {isOwner && menu('Создать канал', <Plus size={16} />, () => ui.openChannelModal({ mode: 'create', guildId: guild.id, type: 'text' }))}
            {!isOwner && <div className="menu__sep" />}
            {!isOwner && menu('Участники и приглашение', <Settings size={16} />, () => ui.openServerSettings(guild.id, 'members'))}
            {!isOwner && menu('Покинуть сервер', <LogOut size={16} />, () => ui.openServerSettings(guild.id, 'overview'), true)}
          </div>
        )}
      </header>

      <div className="side__scroll">
        <ChannelGroup title="Текстовые каналы" onAdd={isOwner ? () => ui.openChannelModal({ mode: 'create', guildId: guild.id, type: 'text' }) : undefined}>
          {text.map((c) => {
            const count = unread[c.id] ?? 0
            return (
              <div key={c.id} className={`channel${c.id === activeId ? ' is-active' : ''}${count ? ' has-unread' : ''}`}>
                <button className="channel__main" onClick={() => chat.openGuildChannel(guild.id, c.id)}>
                  <span className="channel__glyph">#</span>
                  <span className="truncate">{c.name}</span>
                </button>
                {count > 0 && c.id !== activeId && <span className="channel__dot" />}
                {isOwner && <ChannelGear guild={guild} channel={c} />}
              </div>
            )
          })}
        </ChannelGroup>
        <ChannelGroup title="Голосовые каналы" onAdd={isOwner ? () => ui.openChannelModal({ mode: 'create', guildId: guild.id, type: 'voice' }) : undefined}>
          {voice.map((c) => (
            <VoiceChannelRow key={c.id} guild={guild} channel={c} active={c.id === activeId} isOwner={isOwner} />
          ))}
        </ChannelGroup>
      </div>

      <VoicePanel />
      <UserBar onLogout={onLogout} />
    </aside>
  )
}

function ChannelGear({ guild, channel }: { guild: Guild; channel: Channel }) {
  return (
    <button
      className="channel__gear"
      data-tip="Настроить канал"
      aria-label="Настроить канал"
      onClick={() => ui.openChannelModal({ mode: 'edit', guildId: guild.id, channelId: channel.id })}
    >
      <Settings size={14} />
    </button>
  )
}

function VoiceChannelRow({ guild, channel, active, isOwner }: { guild: Guild; channel: Channel; active: boolean; isOwner: boolean }) {
  const members = useVoice((s) => s.rooms[channel.id] ?? NO_MEMBERS)
  const here = useVoice((s) => s.roomId === channel.id)
  return (
    <>
      <div className={`channel channel--voice${active ? ' is-active' : ''}${here ? ' is-here' : ''}`}>
        <button
          className="channel__main"
          onClick={() => {
            chat.openGuildChannel(guild.id, channel.id)
            void joinVoice(channel.id)
          }}
        >
          <Volume2 size={16} className="channel__glyph" />
          <span className="truncate">{channel.name}</span>
          {members.length > 0 && <span className="channel__count">{members.length}</span>}
        </button>
        {isOwner && <ChannelGear guild={guild} channel={channel} />}
      </div>
      {members.length > 0 && (
        <div className="voice-users">
          {members.map((m) => (
            <VoiceUser key={m.userId} member={m} roomId={channel.id} />
          ))}
        </div>
      )}
    </>
  )
}

function VoiceUser({ member, roomId }: { member: VoiceMember; roomId: string }) {
  const user = useChat((s) => s.users[member.userId])
  // Кто говорит — знаем только про свою комнату
  const speaking = useVoice((s) => s.roomId === roomId && Boolean(s.speaking[member.userId]))
  if (!user) return null
  return (
    <button className={`voice-user${speaking ? ' is-speaking' : ''}`} onClick={(e) => ui.showProfile(member.userId, e.currentTarget)}>
      <Avatar user={user} size={22} />
      <span className="truncate">{user.displayName}</span>
      <span className="voice-user__icons">
        {member.screen && <MonitorUp size={13} />}
        {member.video && <Video size={13} />}
        {member.muted && <MicOff size={13} />}
        {member.deafened && <HeadphoneOff size={13} />}
      </span>
    </button>
  )
}

function ChannelGroup({ title, children, onAdd }: { title: string; children: ReactNode; onAdd?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <section className={`chgroup${open ? '' : ' is-collapsed'}`}>
      <div className="chgroup__head">
        <button className="side__label side__label--button" onClick={() => setOpen((v) => !v)}>
          <ChevronDown size={12} className="chgroup__chevron" />
          <span>{title}</span>
        </button>
        {onAdd && (
          <button className="chgroup__add" onClick={onAdd} data-tip="Создать канал" aria-label="Создать канал">
            <Plus size={15} />
          </button>
        )}
      </div>
      <div className="chgroup__list">
        <div>{children}</div>
      </div>
    </section>
  )
}
