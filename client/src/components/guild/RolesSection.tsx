import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ArrowDown, ArrowUp, Check, Lock, Pipette, Plus, RotateCcw, Search, Shield, Trash2, Users, X } from 'lucide-react'
import { api, ApiError, type Guild, type Permission, type Role } from '../../lib/api'
import { plural } from '../../lib/format'
import { canGrant, canManageRole, highestPosition, isEveryone, isHexColor, isOwner, PERMISSION_GROUPS, PERMISSION_INFO, roleMemberCount, ROLE_COLORS } from '../../lib/perms'
import { chat, useChat } from '../../lib/store'
import { Avatar } from '../Avatar'
import { SectionHead, Toggle } from '../settings/controls'
import { RoleDot } from './RoleBits'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

const ROLE_LIMIT = 50
const PEOPLE: [string, string, string] = ['человек', 'человека', 'человек']

type Tab = 'look' | 'perms' | 'members'
type Draft = Partial<Pick<Role, 'name' | 'color' | 'hoist' | 'permissions'>>

const samePerms = (a: Permission[], b: Permission[]) => a.length === b.length && a.every((p) => b.includes(p))

/** Раздел «Роли»: список ролей слева, настройки выбранной — справа */
export function RolesSection({ guild }: { guild: Guild }) {
  // Сервер присылает роли по убыванию, но порядок здесь важен — сортируем сами
  const roles = [...(guild.roles ?? [])].sort((a, b) => b.position - a.position)
  const custom = roles.filter((r) => !isEveryone(guild, r))
  const everyone = roles.find((r) => isEveryone(guild, r))
  const owner = isOwner(guild)
  const [selectedId, setSelectedId] = useState<string | null>(() => custom.find((r) => canManageRole(guild, r))?.id ?? guild.id)
  const [tab, setTab] = useState<Tab>('look')
  const [dirty, setDirty] = useState(false)
  const [nag, setNag] = useState(0)
  const [busy, setBusy] = useState(false)

  const selected = roles.find((r) => r.id === selectedId) ?? everyone
  // Роль удалили (мы или кто-то ещё) — выбираем @everyone
  useEffect(() => {
    if (selectedId && !roles.some((r) => r.id === selectedId)) setSelectedId(guild.id)
  }, [roles, selectedId, guild.id])

  const select = (id: string) => {
    if (id === selected?.id) return
    // Несохранённые изменения не теряем молча — встряхиваем плашку «Сохранить»
    if (dirty) return setNag((n) => n + 1)
    setSelectedId(id)
  }

  const create = async () => {
    if (busy) return
    if (dirty) return setNag((n) => n + 1)
    setBusy(true)
    try {
      const res = await api.createRole(guild.id, {})
      chat.upsertGuild(res.guild)
      setSelectedId(res.role.id)
      setTab('look')
    } catch (err) {
      chat.toast({ title: 'Роль не создалась', text: errorText(err) })
    }
    setBusy(false)
  }

  return (
    <>
      <SectionHead title="Роли" subtitle="Роли дают людям права и цвет имени. Чем выше роль в списке, тем она главнее." />
      <div className="roles">
        <aside className="roles__side">
          <button className="btn btn--primary btn--sm roles__create" onClick={() => void create()} disabled={busy || roles.length >= ROLE_LIMIT}>
            <Plus size={15} /> Создать роль
          </button>
          <div className="roles__list" role="listbox" aria-label="Роли сервера">
            {custom.length === 0 && <p className="roles__empty muted">Ролей пока нет. Создай первую — например, «Модераторы».</p>}
            {custom.map((r, i) => (
              <RoleRow key={r.id} guild={guild} role={r} active={r.id === selected?.id} index={i} onSelect={() => select(r.id)} />
            ))}
            {everyone && (
              <>
                <div className="roles__sep" />
                <RoleRow guild={guild} role={everyone} active={everyone.id === selected?.id} index={custom.length} onSelect={() => select(everyone.id)} />
              </>
            )}
          </div>
          {!owner && <p className="roles__hint muted">Менять можно только роли ниже своей самой высокой.</p>}
        </aside>

        {selected && (
          <RoleEditor
            key={selected.id}
            guild={guild}
            role={selected}
            tab={isEveryone(guild, selected) ? 'perms' : tab}
            onTab={setTab}
            onDirty={setDirty}
            nag={nag}
            onDeleted={() => {
              setDirty(false)
              setSelectedId(guild.id)
            }}
          />
        )}
      </div>
    </>
  )
}

function RoleRow({ guild, role, active, index, onSelect }: { guild: Guild; role: Role; active: boolean; index: number; onSelect: () => void }) {
  const everyone = isEveryone(guild, role)
  const locked = !canManageRole(guild, role)
  const count = roleMemberCount(guild, role.id)
  return (
    <button
      className={`role-row${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms`, ...(role.color ? ({ '--role': role.color } as CSSProperties) : null) }}
      onClick={onSelect}
      role="option"
      aria-selected={active}
    >
      {everyone ? <Users size={14} className="role-row__glyph" /> : <RoleDot color={role.color} />}
      <span className="role-row__name truncate">{role.name}</span>
      {locked && <Lock size={12} className="role-row__lock" />}
      <span className="role-row__count">{count}</span>
    </button>
  )
}

interface EditorProps {
  guild: Guild
  role: Role
  tab: Tab
  onTab: (t: Tab) => void
  onDirty: (dirty: boolean) => void
  nag: number
  onDeleted: () => void
}

function RoleEditor({ guild, role, tab, onTab, onDirty, nag, onDeleted }: EditorProps) {
  const everyone = isEveryone(guild, role)
  const manageable = canManageRole(guild, role)
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [shake, setShake] = useState(false)
  const firstNag = useRef(nag)

  // Черновик поверх того, что пришло с сервера: чужие правки в нетронутых полях видны сразу
  const view = { ...role, ...draft }
  const changed: Draft = {}
  if (draft.name !== undefined && draft.name.trim() !== role.name) changed.name = draft.name.trim()
  if (draft.color !== undefined && draft.color !== role.color) changed.color = draft.color
  if (draft.hoist !== undefined && draft.hoist !== role.hoist) changed.hoist = draft.hoist
  if (draft.permissions && !samePerms(draft.permissions, role.permissions)) changed.permissions = draft.permissions
  const dirty = Object.keys(changed).length > 0
  const nameError = view.name.trim().length === 0 ? 'Название не может быть пустым' : null

  useEffect(() => onDirty(dirty), [dirty, onDirty])
  useEffect(() => () => onDirty(false), [onDirty])

  useEffect(() => {
    if (nag === firstNag.current) return
    setShake(true)
    const t = window.setTimeout(() => setShake(false), 600)
    return () => window.clearTimeout(t)
  }, [nag])

  const patch = (p: Draft) => manageable && setDraft((d) => ({ ...d, ...p }))
  const reset = () => setDraft({})

  const save = async () => {
    if (!dirty || saving || nameError) return
    setSaving(true)
    try {
      chat.upsertGuild((await api.updateRole(guild.id, role.id, everyone ? { permissions: changed.permissions } : changed)).guild)
      setDraft({})
    } catch (err) {
      chat.toast({ title: 'Не сохранилось', text: errorText(err) })
    }
    setSaving(false)
  }

  // Ctrl+S — сохранить
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const move = async (dir: -1 | 1) => {
    try {
      chat.upsertGuild((await api.updateRole(guild.id, role.id, { move: dir })).guild)
    } catch (err) {
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
  }

  const remove = async () => {
    if (!confirmDelete) return setConfirmDelete(true)
    try {
      chat.upsertGuild((await api.deleteRole(guild.id, role.id)).guild)
      chat.toast({ title: 'Роль удалена', text: role.name })
      onDeleted()
    } catch (err) {
      chat.toast({ title: 'Не удалось удалить', text: errorText(err) })
      setConfirmDelete(false)
    }
  }

  // Двигать можно только среди ролей, которыми управляешь: выше своей не поднимешь
  const custom = (guild.roles ?? []).filter((r) => !isEveryone(guild, r)).sort((a, b) => b.position - a.position)
  const index = custom.findIndex((r) => r.id === role.id)
  const above = custom[index - 1]
  const canUp = manageable && index > 0 && (isOwner(guild) || (above !== undefined && above.position < highestPosition(guild)))
  const canDown = manageable && index >= 0 && index < custom.length - 1
  const count = roleMemberCount(guild, role.id)

  return (
    <section className="roles__editor" style={view.color ? ({ '--role': view.color } as CSSProperties) : undefined}>
      <header className="role-head">
        <span className={`role-head__badge${view.color ? '' : ' is-plain'}`}>{everyone ? <Users size={20} /> : <Shield size={20} />}</span>
        <div className="role-head__text">
          <h3 className="truncate">{everyone ? '@everyone' : view.name.trim() || 'Без названия'}</h3>
          <span>
            {everyone ? 'есть у всех участников' : plural(count, PEOPLE)}
            {!manageable && ' · только просмотр'}
          </span>
        </div>
        {!everyone && (
          <div className="role-head__tools">
            <button className="icon-btn" disabled={!canUp} onClick={() => void move(-1)} data-tip="Выше" aria-label="Поднять роль">
              <ArrowUp size={16} />
            </button>
            <button className="icon-btn" disabled={!canDown} onClick={() => void move(1)} data-tip="Ниже" aria-label="Опустить роль">
              <ArrowDown size={16} />
            </button>
            {manageable && (
              <button
                className={`btn btn--sm ${confirmDelete ? 'btn--primary' : 'btn--ghost'} role-head__delete`}
                onClick={() => void remove()}
                onBlur={() => setConfirmDelete(false)}
              >
                <Trash2 size={15} /> {confirmDelete ? 'Точно удалить?' : 'Удалить'}
              </button>
            )}
          </div>
        )}
      </header>

      {everyone ? (
        <p className="role-note">
          Эти права есть у каждого участника сервера. Другие роли могут только <b>добавить</b> права, а исключения в каналах — открыть или закрыть доступ точечно.
        </p>
      ) : (
        <div className="role-tabs" role="tablist">
          {(
            [
              ['look', 'Вид'],
              ['perms', 'Права'],
              ['members', `Участники · ${count}`],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`role-tabs__tab${tab === id ? ' is-active' : ''}`} onClick={() => onTab(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="role-body" key={tab}>
        {tab === 'look' && <LookTab view={view} disabled={!manageable} nameError={nameError} onChange={patch} />}
        {tab === 'perms' && <PermsTab guild={guild} role={role} permissions={view.permissions} disabled={!manageable} onChange={(permissions) => patch({ permissions })} />}
        {tab === 'members' && <MembersTab guild={guild} role={role} disabled={!manageable} />}
      </div>

      {(dirty || saving) && (
        <div className={`savebar${shake ? ' is-shaking' : ''}`} role="status">
          <span className="savebar__text">{shake ? 'Сохрани или сбрось!' : 'Есть изменения'}</span>
          <div className="savebar__actions">
            <button className="btn btn--ghost btn--sm" onClick={reset} disabled={saving}>
              <RotateCcw size={14} /> Сбросить
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => void save()} disabled={saving || Boolean(nameError)}>
              <Check size={15} /> {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ============ вкладка «Вид» ============

function LookTab({ view, disabled, nameError, onChange }: { view: Role; disabled: boolean; nameError: string | null; onChange: (p: Draft) => void }) {
  const me = useChat((s) => s.me!)
  const [hex, setHex] = useState(view.color ?? '')
  useEffect(() => setHex(view.color ?? ''), [view.color])
  const custom = view.color !== null && !ROLE_COLORS.includes(view.color.toLowerCase())

  const typeHex = (value: string) => {
    const v = (value.startsWith('#') ? value : `#${value}`).slice(0, 7)
    setHex(value === '' ? '' : v)
    if (isHexColor(v)) onChange({ color: v.toLowerCase() })
  }

  return (
    <div className="role-look">
      <label className="role-field">
        <span className="set-group__title">Название роли</span>
        <input
          className="input"
          value={view.name}
          maxLength={32}
          disabled={disabled}
          placeholder="Например, Модераторы"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        {nameError && <span className="form-error">{nameError}</span>}
      </label>

      <div className="role-field">
        <span className="set-group__title">Цвет</span>
        <div className="swatches" role="radiogroup" aria-label="Цвет роли">
          {ROLE_COLORS.map((c) => {
            const active = (view.color?.toLowerCase() ?? null) === c
            return (
              <button
                key={c ?? 'none'}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                className={`swatch${c ? '' : ' swatch--none'}${active ? ' is-active' : ''}`}
                style={c ? ({ '--role': c } as CSSProperties) : undefined}
                onClick={() => onChange({ color: c })}
                data-tip={c ? c : 'Без цвета'}
                aria-label={c ? `Цвет ${c}` : 'Без цвета'}
              >
                {active && <Check size={13} />}
              </button>
            )
          })}
          <label
            className={`swatch swatch--custom${custom ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
            style={custom && view.color ? ({ '--role': view.color } as CSSProperties) : undefined}
            data-tip="Свой цвет"
          >
            <Pipette size={13} />
            <input type="color" value={view.color ?? '#ffffff'} disabled={disabled} onChange={(e) => onChange({ color: e.target.value.toLowerCase() })} />
          </label>
        </div>
        <div className="hex-field">
          <span className="hex-field__preview" style={view.color ? ({ '--role': view.color } as CSSProperties) : undefined} />
          <input
            className="input hex-field__input"
            value={hex}
            disabled={disabled}
            placeholder="без цвета"
            maxLength={7}
            spellCheck={false}
            onChange={(e) => typeHex(e.target.value.trim())}
            onBlur={() => setHex(view.color ?? '')}
          />
          {view.color && !disabled && (
            <button className="icon-btn" onClick={() => onChange({ color: null })} data-tip="Убрать цвет" aria-label="Убрать цвет">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="role-preview">
        <span className="set-group__title">Как это выглядит</span>
        <div className="role-preview__card">
          <Avatar user={me} size={34} />
          <div className="role-preview__text">
            <b style={view.color ? { color: view.color } : undefined}>{me.displayName}</b>
            <span>
              <RoleDot color={view.color} size={8} /> {view.name.trim() || 'Без названия'}
            </span>
          </div>
          <span className="role-preview__msg">привет всем!</span>
        </div>
      </div>

      <Toggle
        label="Показывать отдельно"
        hint="Люди с этой ролью — своей группой в списке участников справа."
        checked={view.hoist}
        disabled={disabled}
        onChange={(hoist) => onChange({ hoist })}
      />
    </div>
  )
}

// ============ вкладка «Права» ============

function PermsTab({ guild, role, permissions, disabled, onChange }: { guild: Guild; role: Role; permissions: Permission[]; disabled: boolean; onChange: (p: Permission[]) => void }) {
  const admin = permissions.includes('ADMINISTRATOR')
  const flip = (perm: Permission, on: boolean) => onChange(on ? [...permissions.filter((p) => p !== perm), perm] : permissions.filter((p) => p !== perm))
  const total = PERMISSION_GROUPS.reduce((n, g) => n + g.perms.length, 0)
  return (
    <div className="role-perms">
      <div className="role-perms__summary">
        <span>
          Включено <b>{permissions.length}</b> из {total}
        </span>
        {!disabled && permissions.length > 0 && !isEveryone(guild, role) && (
          <button className="btn btn--ghost btn--sm" onClick={() => onChange([])}>
            <X size={14} /> Снять все
          </button>
        )}
      </div>
      {admin && (
        <div className="role-note role-note--warn">
          <Shield size={15} /> У роли есть «Администратор» — остальные переключатели уже ничего не ограничивают.
        </div>
      )}
      {PERMISSION_GROUPS.map((g) => (
        <section key={g.title} className="perm-group">
          <h4 className="set-group__title">{g.title}</h4>
          {g.perms.map((p) => {
            const locked = !canGrant(guild, p)
            return (
              <div key={p} className={`perm-row${p === 'ADMINISTRATOR' ? ' perm-row--admin' : ''}`}>
                <Toggle
                  label={PERMISSION_INFO[p].label}
                  hint={locked && !disabled ? `${PERMISSION_INFO[p].description} У тебя самого этого права нет.` : PERMISSION_INFO[p].description}
                  checked={permissions.includes(p)}
                  disabled={disabled || locked}
                  onChange={(on) => flip(p, on)}
                />
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}

// ============ вкладка «Участники» ============

function MembersTab({ guild, role, disabled }: { guild: Guild; role: Role; disabled: boolean }) {
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const has = (id: string) => Boolean(guild.memberRoles?.[id]?.includes(role.id))
  const holders = guild.members.filter((m) => has(m.id)).sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'))
  const q = query.trim().toLowerCase()
  const candidates = useMemo(
    () =>
      q
        ? guild.members
            .filter((m) => !guild.memberRoles?.[m.id]?.includes(role.id))
            .filter((m) => m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
            .slice(0, 6)
        : [],
    [guild.members, guild.memberRoles, role.id, q],
  )

  const setHas = async (userId: string, on: boolean) => {
    if (busy) return
    setBusy(userId)
    const current = guild.memberRoles?.[userId] ?? []
    const next = on ? [...current.filter((id) => id !== role.id), role.id] : current.filter((id) => id !== role.id)
    try {
      chat.upsertGuild((await api.setMemberRoles(guild.id, userId, next)).guild)
      if (on) setQuery('')
    } catch (err) {
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
    setBusy(null)
  }

  return (
    <div className="role-members">
      {!disabled && (
        <div className="role-members__add">
          <span className="search-field">
            <Search size={15} />
            <input className="input" value={query} placeholder="Добавить: имя или логин" onChange={(e) => setQuery(e.target.value)} />
          </span>
          {q && (
            <div className="role-members__found">
              {candidates.length === 0 && <span className="muted">Никого не нашли — или у всех уже есть эта роль.</span>}
              {candidates.map((m) => (
                <button key={m.id} className="role-member role-member--add" onClick={() => void setHas(m.id, true)} disabled={busy !== null}>
                  <Avatar user={m} size={26} />
                  <span className="truncate">{m.displayName}</span>
                  <span className="role-member__login truncate">@{m.username}</span>
                  <Plus size={15} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {holders.length === 0 ? (
        <p className="role-note">У этой роли пока никого нет.{!disabled && ' Найди человека в поиске выше или выдай роль в разделе «Участники».'}</p>
      ) : (
        <div className="role-members__list">
          {holders.map((m) => (
            <div key={m.id} className="role-member">
              <Avatar user={m} size={26} />
              <span className="truncate" style={role.color ? { color: role.color } : undefined}>
                {m.displayName}
              </span>
              <span className="role-member__login truncate">@{m.username}</span>
              {!disabled && (
                <button className="icon-btn role-member__x" onClick={() => void setHas(m.id, false)} disabled={busy !== null} data-tip="Снять роль" aria-label="Снять роль">
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
