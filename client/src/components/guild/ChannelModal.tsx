import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Check, Hash, Lock, Plus, RotateCcw, Slash, Trash2, Users, Volume2, X } from 'lucide-react'
import { api, ApiError, type Channel, type Guild, type Override, type Permission, type Role } from '../../lib/api'
import { can, canManageRole, CHANNEL_PERMS_BY_TYPE, isEveryone, PERMISSION_INFO } from '../../lib/perms'
import { chat, useChat } from '../../lib/store'
import { ui, useUi } from '../../lib/ui'
import { Modal } from '../Modal'
import { Toggle } from '../settings/controls'
import { Popover } from './Popover'
import { RoleDot } from './RoleBits'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

/** Создать канал / настроить канал: название, удаление и права ролей */
export function ChannelModal() {
  const modal = useUi((s) => s.channelModal)
  if (!modal) return null
  return modal.mode === 'create' ? (
    <CreateChannel key={`create-${modal.type}`} guildId={modal.guildId} initialType={modal.type} />
  ) : (
    <EditChannel key={modal.channelId} guildId={modal.guildId} channelId={modal.channelId} />
  )
}

function CreateChannel({ guildId, initialType }: { guildId: string; initialType: 'text' | 'voice' }) {
  const [type, setType] = useState(initialType)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const { guild, channel } = await api.createChannel(guildId, name, type)
      chat.upsertGuild(guild)
      if (channel.type === 'text') chat.openGuildChannel(guildId, channel.id)
      ui.closeChannelModal()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Создать канал" subtitle="Текстовый — для переписки, голосовой — чтобы созвониться." onClose={ui.closeChannelModal}>
      <form className="modal__form" onSubmit={submit}>
        <div className="type-cards">
          <button type="button" className={`type-card${type === 'text' ? ' is-active' : ''}`} onClick={() => setType('text')}>
            <Hash size={22} />
            <span>
              <b>Текстовый</b>
              <span>Сообщения, мемы, ссылки</span>
            </span>
          </button>
          <button type="button" className={`type-card${type === 'voice' ? ' is-active' : ''}`} onClick={() => setType('voice')}>
            <Volume2 size={22} />
            <span>
              <b>Голосовой</b>
              <span>Голос, видео, экран</span>
            </span>
          </button>
        </div>
        <label className="modal__label">
          <span className="label">Название канала</span>
          <span className="channel-input">
            {type === 'text' ? <Hash size={16} /> : <Volume2 size={16} />}
            <input className="input" value={name} autoFocus maxLength={32} placeholder={type === 'text' ? 'новый-канал' : 'Болталка'} onChange={(e) => setName(e.target.value)} />
          </span>
        </label>
        {error && <div className="modal__error">{error}</div>}
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={ui.closeChannelModal}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={!name.trim() || busy}>
            Создать канал
          </button>
        </div>
      </form>
    </Modal>
  )
}

function EditChannel({ guildId, channelId }: { guildId: string; channelId: string }) {
  const guild = useChat((s) => s.guilds.find((g) => g.id === guildId))
  const channel = guild?.channels.find((c) => c.id === channelId)
  const [tab, setTab] = useState<'overview' | 'perms'>('overview')
  const canChannels = can(guild, 'MANAGE_CHANNELS')
  const canRoles = can(guild, 'MANAGE_ROLES')

  // Канал удалили или он пропал из виду (закрыли доступ) — окно больше не нужно
  useEffect(() => {
    if (!channel) ui.closeChannelModal()
  }, [channel])
  if (!guild || !channel) return null

  // Нет права на каналы — сразу на вкладку прав (и наоборот)
  const shown = !canRoles ? 'overview' : !canChannels ? 'perms' : tab
  const Icon = channel.type === 'text' ? Hash : Volume2

  return (
    <Modal title="Настройки канала" subtitle={`${channel.type === 'text' ? 'Текстовый' : 'Голосовой'} канал · ${guild.name}`} onClose={ui.closeChannelModal}>
      <div className={`chmodal${shown === 'perms' ? ' chmodal--wide' : ''}`}>
        {canChannels && canRoles && (
          <div className="role-tabs chmodal__tabs" role="tablist">
            <button role="tab" aria-selected={shown === 'overview'} className={`role-tabs__tab${shown === 'overview' ? ' is-active' : ''}`} onClick={() => setTab('overview')}>
              <Icon size={14} /> Обзор
            </button>
            <button role="tab" aria-selected={shown === 'perms'} className={`role-tabs__tab${shown === 'perms' ? ' is-active' : ''}`} onClick={() => setTab('perms')}>
              <Lock size={14} /> Права
            </button>
          </div>
        )}
        {shown === 'overview' && canChannels && <ChannelOverview guildId={guildId} channel={channel} />}
        {shown === 'perms' && canRoles && <ChannelPerms guild={guild} channel={channel} />}
        {!canChannels && !canRoles && <p className="muted">У тебя нет прав настраивать этот канал.</p>}
      </div>
    </Modal>
  )
}

function ChannelOverview({ guildId, channel }: { guildId: string; channel: Channel }) {
  const channelId = channel.id
  const [name, setName] = useState(channel.name)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      chat.upsertGuild((await api.updateChannel(guildId, channelId, { name })).guild)
      ui.closeChannelModal()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true)
    setBusy(true)
    try {
      chat.upsertGuild((await api.deleteChannel(guildId, channelId)).guild)
      ui.closeChannelModal()
      chat.toast({ title: 'Канал удалён', text: `${channel.type === 'text' ? '#' : ''}${channel.name}` })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form className="modal__form" onSubmit={save}>
      <label className="modal__label">
        <span className="label">Название</span>
        <span className="channel-input">
          {channel.type === 'text' ? <Hash size={16} /> : <Volume2 size={16} />}
          <input className="input" value={name} autoFocus maxLength={32} onChange={(e) => setName(e.target.value)} />
        </span>
      </label>
      {error && <div className="modal__error">{error}</div>}
      <div className="modal__actions modal__actions--split">
        <button type="button" className={`btn ${confirmDelete ? 'btn--primary' : 'btn--ghost'}`} onClick={() => void remove()} disabled={busy}>
          <Trash2 size={16} /> {confirmDelete ? 'Точно удалить? Сообщения пропадут' : 'Удалить канал'}
        </button>
        <button type="submit" className="btn btn--primary" disabled={!name.trim() || busy}>
          Сохранить
        </button>
      </div>
    </form>
  )
}

// ============ права в канале ============

type Tri = 'deny' | 'inherit' | 'allow'

const EMPTY: Override = { allow: [], deny: [] }
const isEmptyOverride = (o?: Override) => !o || (o.allow.length === 0 && o.deny.length === 0)

const TRI: { value: Tri; label: string; icon: typeof X }[] = [
  { value: 'deny', label: 'Запретить', icon: X },
  { value: 'inherit', label: 'Как у роли', icon: Slash },
  { value: 'allow', label: 'Разрешить', icon: Check },
]

/** Вкладка «Права»: приватный канал и исключения (разрешить / как у роли / запретить) для ролей */
function ChannelPerms({ guild, channel }: { guild: Guild; channel: Channel }) {
  const perms = CHANNEL_PERMS_BY_TYPE[channel.type]
  const roles = [...(guild.roles ?? [])].sort((a, b) => b.position - a.position)
  const everyone = roles.find((r) => isEveryone(guild, r))
  const [selectedId, setSelectedId] = useState(guild.id)
  // Оптимистичные правки: показываем сразу, не дожидаясь ответа сервера
  const [local, setLocal] = useState<Record<string, Override>>({})
  const seq = useRef<Record<string, number>>({})
  const [adding, setAdding] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)

  const overrideOf = (roleId: string): Override => local[roleId] ?? channel.overrides?.[roleId] ?? EMPTY
  const selected = roles.find((r) => r.id === selectedId) ?? everyone
  const listed = roles.filter((r) => isEveryone(guild, r) || r.id === selected?.id || !isEmptyOverride(overrideOf(r.id)))
  const addable = roles.filter((r) => !listed.includes(r) && canManageRole(guild, r))
  const isPrivate = overrideOf(guild.id).deny.includes('VIEW_CHANNEL')
  const viewers = roles.filter((r) => !isEveryone(guild, r) && overrideOf(r.id).allow.includes('VIEW_CHANNEL'))

  const write = async (roleId: string, next: Override) => {
    const n = (seq.current[roleId] ?? 0) + 1
    seq.current[roleId] = n
    setLocal((l) => ({ ...l, [roleId]: next }))
    try {
      chat.upsertGuild((await api.setOverride(guild.id, channel.id, roleId, next)).guild)
    } catch (err) {
      chat.toast({ title: 'Права не сохранились', text: errorText(err) })
    }
    // Пока ждали, могли нажать ещё — тогда черновик оставляем до последнего ответа
    if (seq.current[roleId] !== n) return
    setLocal((l) => {
      const { [roleId]: _done, ...rest } = l
      return rest
    })
  }

  const setState = (roleId: string, perm: Permission, state: Tri) => {
    const o = overrideOf(roleId)
    const allow = o.allow.filter((p) => p !== perm)
    const deny = o.deny.filter((p) => p !== perm)
    if (state === 'allow') allow.push(perm)
    if (state === 'deny') deny.push(perm)
    void write(roleId, { allow, deny })
  }

  const privateHint = isPrivate
    ? viewers.length
      ? `Канал видят: ${viewers.map((r) => r.name).join(', ')} — и администраторы.`
      : 'Сейчас канал видят только владелец и администраторы. Открой доступ нужным ролям ниже — право «Видеть каналы».'
    : 'Канал увидят только те роли, которым ты откроешь доступ.'

  return (
    <div className="chperms">
      <div className={`chperms__private${isPrivate ? ' is-on' : ''}`}>
        <Lock size={18} className="chperms__lock" />
        <Toggle label="Приватный канал" hint={privateHint} checked={isPrivate} onChange={(on) => setState(guild.id, 'VIEW_CHANNEL', on ? 'deny' : 'inherit')} />
      </div>

      <div className="chperms__grid">
        <div className="chperms__roles">
          <span className="set-group__title">Роли</span>
          {listed.map((r) => {
            const o = overrideOf(r.id)
            return (
              <button
                key={r.id}
                className={`chperms__role${r.id === selected?.id ? ' is-active' : ''}`}
                style={r.color ? ({ '--role': r.color } as CSSProperties) : undefined}
                onClick={() => setSelectedId(r.id)}
              >
                {isEveryone(guild, r) ? <Users size={13} /> : <RoleDot color={r.color} />}
                <span className="truncate">{r.name}</span>
                {(o.allow.length > 0 || o.deny.length > 0) && (
                  <span className="chperms__sum">
                    {o.allow.length > 0 && <i className="is-allow">+{o.allow.length}</i>}
                    {o.deny.length > 0 && <i className="is-deny">−{o.deny.length}</i>}
                  </span>
                )}
              </button>
            )
          })}
          {addable.length > 0 && (
            <button ref={addRef} className={`chperms__add${adding ? ' is-open' : ''}`} onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              <Plus size={14} /> добавить роль
            </button>
          )}
          {adding && (
            <Popover anchorRef={addRef} onClose={() => setAdding(false)} className="role-menu">
              <div className="role-menu__title">Исключение для роли</div>
              <div className="role-menu__list">
                {addable.map((r) => (
                  <button
                    key={r.id}
                    className="role-menu__item"
                    onClick={() => {
                      setAdding(false)
                      setSelectedId(r.id)
                    }}
                  >
                    <RoleDot color={r.color} />
                    <span className="truncate">{r.name}</span>
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>

        {selected && <RoleOverride key={selected.id} guild={guild} role={selected} perms={perms} override={overrideOf(selected.id)} onSet={setState} onClear={() => void write(selected.id, { allow: [], deny: [] })} />}
      </div>
    </div>
  )
}

interface OverrideProps {
  guild: Guild
  role: Role
  perms: Permission[]
  override: Override
  onSet: (roleId: string, perm: Permission, state: Tri) => void
  onClear: () => void
}

function RoleOverride({ guild, role, perms, override, onSet, onClear }: OverrideProps) {
  const manageable = canManageRole(guild, role)
  const roleHas = (p: Permission) => role.permissions.includes(p) || role.permissions.includes('ADMINISTRATOR')
  return (
    <div className="chperms__perms">
      <div className="chperms__head">
        <span className="set-group__title">
          Права для <b style={role.color ? { color: role.color } : undefined}>{role.name}</b>
        </span>
        {manageable && !isEmptyOverride(override) && (
          <button className="btn btn--ghost btn--sm" onClick={onClear}>
            <RotateCcw size={14} /> Сбросить
          </button>
        )}
      </div>
      {!manageable && <p className="role-note">Эта роль не ниже твоей — её права здесь менять нельзя.</p>}
      {perms.map((p) => {
        const value: Tri = override.allow.includes(p) ? 'allow' : override.deny.includes(p) ? 'deny' : 'inherit'
        return (
          <div key={p} className={`tri-row tri-row--${value}`}>
            <div className="tri-row__text">
              <b>{PERMISSION_INFO[p].label}</b>
              <span>{PERMISSION_INFO[p].description}</span>
              <span className="tri-row__base">{isEveryone(guild, role) ? 'по умолчанию' : 'у роли'}: {roleHas(p) ? 'есть' : 'нет'}</span>
            </div>
            <div className="tri" role="radiogroup" aria-label={PERMISSION_INFO[p].label}>
              {TRI.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={value === t.value}
                  aria-label={t.label}
                  data-tip={t.label}
                  disabled={!manageable}
                  className={`tri__opt tri__opt--${t.value}${value === t.value ? ' is-active' : ''}`}
                  onClick={() => value !== t.value && onSet(role.id, p, t.value)}
                >
                  <t.icon size={14} strokeWidth={2.4} />
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
