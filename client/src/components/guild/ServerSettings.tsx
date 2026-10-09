import { useEffect, useState, type FormEvent } from 'react'
import { ArrowDown, ArrowUp, Check, Copy, Hash, LayoutGrid, Lock, LogOut, Pencil, Plus, Shield, Trash2, UserPlus, Users, Volume2, X } from 'lucide-react'
import { api, ApiError, PERMISSIONS, type Channel, type Guild } from '../../lib/api'
import { initials, MEMBERS, plural } from '../../lib/format'
import { can, isPrivateChannel, PERMISSION_INFO, rolesOf } from '../../lib/perms'
import { chat, useChat } from '../../lib/store'
import { ui, useUi, type ServerSection } from '../../lib/ui'
import { useIsMobile } from '../../lib/mobile'
import { Group, SectionHead } from '../settings/controls'
import { MobileBar, MobileTop } from '../settings/Settings'
import { MembersSection } from './MembersSection'
import { RoleChip } from './RoleBits'
import { RolesSection } from './RolesSection'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

/** Полноэкранные настройки сервера: обзор, роли, каналы, участники, приглашение — что видно, зависит от прав */
export function ServerSettings() {
  const state = useUi((s) => s.serverSettings)
  const guild = useChat((s) => (state ? s.guilds.find((g) => g.id === state.guildId) : undefined))
  const meId = useChat((s) => s.me?.id)
  const list = useUi((s) => s.settingsList)
  const mobile = useIsMobile()

  useEffect(() => {
    if (!state) return
    // Esc в открытом поверх окне канала закрывает только его
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !useUi.getState().channelModal && ui.closeServerSettings()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])

  // Сервер удалили или нас с него убрали — закрываемся
  useEffect(() => {
    if (state && !guild) ui.closeServerSettings()
  }, [state, guild])

  if (!state || !guild) return null
  const isOwner = guild.ownerId === meId
  const go = (s: ServerSection) => ui.openServerSettings(guild.id, s)

  const allowed: Record<ServerSection, boolean> = {
    overview: true,
    roles: can(guild, 'MANAGE_ROLES'),
    channels: can(guild, 'MANAGE_CHANNELS'),
    members: true,
    invite: can(guild, 'CREATE_INVITE'),
  }
  // Права могли забрать прямо сейчас — тогда возвращаемся в «Обзор»
  const section = allowed[state.section] ? state.section : 'overview'
  const topRole = meId ? rolesOf(guild, meId)[0] : undefined

  const groups: { title: string; items: { id: ServerSection; label: string; icon: typeof Hash }[] }[] = [
    {
      title: 'Сервер',
      items: [
        { id: 'overview', label: 'Обзор', icon: LayoutGrid },
        { id: 'roles', label: 'Роли', icon: Shield },
        { id: 'channels', label: 'Каналы', icon: Hash },
      ],
    },
    {
      title: 'Люди',
      items: [
        { id: 'members', label: 'Участники', icon: Users },
        { id: 'invite', label: 'Приглашение', icon: UserPlus },
      ],
    },
  ]

  return (
    <div className={`settings zoomed${mobile ? (list ? ' is-list' : ' is-section') : ''}`} role="dialog" aria-modal="true" aria-label="Настройки сервера">
      <nav className="settings__nav">
        <div className="settings__nav-inner">
          {mobile && <MobileTop title="Настройки сервера" onClose={ui.closeServerSettings} />}
          <div className="server-badge">
            <span className="server-badge__icon">{initials(guild.name)}</span>
            <span className="settings__me-text">
              <span className="truncate">{guild.name}</span>
              <span className="settings__me-sub truncate">{isOwner ? 'ты владелец' : topRole ? `роль: ${topRole.name}` : 'настройки сервера'}</span>
            </span>
          </div>
          {groups.map((g) => (
            <div key={g.title} className="settings__group">
              <div className="settings__group-title">{g.title}</div>
              {g.items
                .filter((n) => allowed[n.id])
                .map((n) => (
                  <button key={n.id} className={`settings__item${section === n.id ? ' is-active' : ''}`} onClick={() => go(n.id)}>
                    <n.icon size={17} />
                    {n.label}
                  </button>
                ))}
            </div>
          ))}
          <div className="settings__sep" />
          <div className="settings__version">nuntius · сервер</div>
        </div>
      </nav>

      <main className="settings__content">
        {mobile && <MobileBar back={guild.name} onClose={ui.closeServerSettings} />}
        <div className="settings__content-inner" key={section}>
          {section === 'overview' && <Overview guild={guild} isOwner={isOwner} />}
          {section === 'roles' && <RolesSection guild={guild} />}
          {section === 'channels' && <Channels guild={guild} />}
          {section === 'members' && <MembersSection guild={guild} />}
          {section === 'invite' && <Invite guild={guild} />}
        </div>
        <div className="settings__tools">
          <button className="settings__close" onClick={ui.closeServerSettings} aria-label="Закрыть настройки сервера">
            <span className="settings__close-x">
              <X size={20} />
            </span>
            <span className="settings__close-hint">ESC</span>
          </button>
        </div>
      </main>
    </div>
  )
}

function Overview({ guild, isOwner }: { guild: Guild; isOwner: boolean }) {
  const canRename = can(guild, 'MANAGE_SERVER')
  const meId = useChat((s) => s.me?.id ?? '')
  const myRoles = rolesOf(guild, meId)
  const myPerms = isOwner || can(guild, 'ADMINISTRATOR') ? [...PERMISSIONS] : PERMISSIONS.filter((p) => can(guild, p))
  const [name, setName] = useState(guild.name)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [leaveConfirm, setLeaveConfirm] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || name.trim() === guild.name || busy) return
    setBusy(true)
    try {
      chat.upsertGuild((await api.renameGuild(guild.id, name.trim())).guild)
      chat.toast({ title: 'Сохранено', text: `Сервер теперь называется «${name.trim()}»` })
    } catch (err) {
      chat.toast({ title: 'Не сохранилось', text: errorText(err) })
    }
    setBusy(false)
  }

  const remove = async () => {
    try {
      await api.deleteGuild(guild.id)
      chat.removeGuild(guild.id)
      ui.closeServerSettings()
      chat.toast({ title: 'Сервер удалён', text: guild.name })
    } catch (err) {
      chat.toast({ title: 'Не удалось удалить', text: errorText(err) })
    }
  }

  const leave = async () => {
    if (!leaveConfirm) return setLeaveConfirm(true)
    try {
      await api.leaveGuild(guild.id)
      chat.removeGuild(guild.id)
      ui.closeServerSettings()
    } catch (err) {
      chat.toast({ title: 'Не получилось выйти', text: errorText(err) })
    }
  }

  return (
    <>
      <SectionHead title="Обзор" subtitle={isOwner ? 'Название и судьба сервера.' : canRename ? 'Название сервера и твоё место на нём.' : 'Сервер, на котором ты состоишь.'} />
      <div className="server-overview glow">
        <span className="server-overview__icon">{initials(name || guild.name)}</span>
        {canRename ? (
          <form className="server-overview__form" onSubmit={save}>
            <span className="set-group__title">Название сервера</span>
            <div className="inline-edit__line">
              <input className="input" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn--primary btn--sm" disabled={!name.trim() || name.trim() === guild.name || busy}>
                <Check size={15} /> Сохранить
              </button>
            </div>
          </form>
        ) : (
          <div>
            <div className="account-card__name">{guild.name}</div>
            <div className="muted">
              {plural(guild.members.length, MEMBERS)} · {plural(guild.channels.length, ['канал', 'канала', 'каналов'])}
            </div>
          </div>
        )}
      </div>

      {!isOwner && (
        <Group title="Ты на этом сервере">
          <div className="my-roles">
            {myRoles.length ? myRoles.map((r) => <RoleChip key={r.id} role={r} />) : <span className="muted">Особых ролей нет — только @everyone.</span>}
          </div>
          <div className="my-perms">
            {myPerms.length ? (
              myPerms.map((p) => (
                <span key={p} className="my-perms__item" data-tip={PERMISSION_INFO[p].description}>
                  <Check size={12} /> {PERMISSION_INFO[p].label}
                </span>
              ))
            ) : (
              <span className="muted">Прав на сервере нет.</span>
            )}
          </div>
        </Group>
      )}

      {isOwner && !guild.isLobby && (
        <Group title="Опасная зона" danger>
          <p className="muted">Удаление нельзя отменить: пропадут все каналы и сообщения. Чтобы подтвердить, впиши название сервера.</p>
          <div className="set-actions">
            <input className="input" value={confirm} placeholder={guild.name} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn btn--primary" disabled={confirm.trim() !== guild.name} onClick={() => void remove()}>
              <Trash2 size={16} /> Удалить сервер
            </button>
          </div>
        </Group>
      )}
      {isOwner && guild.isLobby && (
        <Group title="Общий сервер">
          <p className="muted">Это общий сервер — на него попадают все новые люди, поэтому удалить его нельзя. Переименовать — можно.</p>
        </Group>
      )}
      {!isOwner && (
        <Group title="Покинуть сервер" danger>
          <div className="set-actions">
            <button className={`btn ${leaveConfirm ? 'btn--primary' : 'btn--outline'}`} onClick={() => void leave()}>
              <LogOut size={16} /> {leaveConfirm ? 'Точно выйти?' : 'Покинуть сервер'}
            </button>
            <span className="muted">Вернуться можно по коду приглашения.</span>
          </div>
        </Group>
      )}
    </>
  )
}

function Channels({ guild }: { guild: Guild }) {
  const text = guild.channels.filter((c) => c.type === 'text')
  const voice = guild.channels.filter((c) => c.type === 'voice')
  return (
    <>
      <SectionHead title="Каналы" subtitle="Создавай, переименовывай, двигай и удаляй текстовые и голосовые каналы." />
      <ChannelList guild={guild} title="Текстовые каналы" type="text" channels={text} />
      <ChannelList guild={guild} title="Голосовые каналы" type="voice" channels={voice} />
    </>
  )
}

function ChannelList({ guild, title, type, channels }: { guild: Guild; title: string; type: Channel['type']; channels: Channel[] }) {
  return (
    <Group title={title}>
      <div className="ch-list">
        {channels.map((c, i) => (
          <ChannelItem key={c.id} guild={guild} channel={c} first={i === 0} last={i === channels.length - 1} />
        ))}
      </div>
      <button className="btn btn--outline btn--sm ch-list__add" onClick={() => ui.openChannelModal({ mode: 'create', guildId: guild.id, type })}>
        <Plus size={15} /> {type === 'text' ? 'Текстовый канал' : 'Голосовой канал'}
      </button>
    </Group>
  )
}

function ChannelItem({ guild, channel, first, last }: { guild: Guild; channel: Channel; first: boolean; last: boolean }) {
  const move = async (dir: -1 | 1) => {
    try {
      chat.upsertGuild((await api.updateChannel(guild.id, channel.id, { move: dir })).guild)
    } catch (err) {
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
  }
  return (
    <div className="ch-item">
      {channel.type === 'text' ? <Hash size={16} /> : <Volume2 size={16} />}
      <span className="truncate">{channel.name}</span>
      {isPrivateChannel(guild, channel) && (
        <span className="ch-item__lock" data-tip="Приватный канал">
          <Lock size={13} />
        </span>
      )}
      <div className="ch-item__tools">
        <button className="icon-btn" disabled={first} onClick={() => void move(-1)} data-tip="Выше" aria-label="Выше">
          <ArrowUp size={15} />
        </button>
        <button className="icon-btn" disabled={last} onClick={() => void move(1)} data-tip="Ниже" aria-label="Ниже">
          <ArrowDown size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => ui.openChannelModal({ mode: 'edit', guildId: guild.id, channelId: channel.id })}
          data-tip={can(guild, 'MANAGE_ROLES') ? 'Название и права' : 'Переименовать или удалить'}
          aria-label="Настроить"
        >
          <Pencil size={15} />
        </button>
      </div>
    </div>
  )
}

function Invite({ guild }: { guild: Guild }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(guild.id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // буфер обмена недоступен — код можно выделить вручную
    }
  }
  return (
    <>
      <SectionHead title="Приглашение" subtitle="Отправь другу код — он вставит его в «Войти по приглашению» (компас в левой колонке)." />
      <div className="invite glow">
        <code className="invite__code">{guild.id}</code>
        <button className={`btn btn--primary invite__copy${copied ? ' is-copied' : ''}`} onClick={() => void copy()}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
    </>
  )
}
