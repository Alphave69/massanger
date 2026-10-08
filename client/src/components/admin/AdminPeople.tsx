import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Crown, Gift, MessageCircle, Search, Shield, X } from 'lucide-react'
import { openDmWith } from '../../lib/actions'
import { api, type AdminUser, type AdminUserPatch, type BadgeDef, type Me } from '../../lib/api'
import { badgeDef, calmMotion, GROUPS, loadBadges, TIER_LABEL, unknownBadge, useBadges } from '../../lib/badges'
import { formatDay, plural } from '../../lib/format'
import { STATUS_LABEL } from '../../lib/status'
import { chat, useChat } from '../../lib/store'
import { ui } from '../../lib/ui'
import { Avatar } from '../Avatar'
import { BadgeIcon } from '../badges/BadgeIcon'
import { Toggle } from '../settings/controls'
import { UserTags } from '../UserTags'
import { errorText, fmtNum, presenceOfAdmin, shortDate } from './bits'

export type PeopleFilter = 'all' | 'online' | 'admins' | 'verified' | 'banned'
type Sort = 'number' | 'newest' | 'messages' | 'badges'

const FILTERS: { id: PeopleFilter; label: string; test: (u: AdminUser) => boolean }[] = [
  { id: 'all', label: 'Все', test: () => true },
  { id: 'online', label: 'В сети', test: (u) => u.online },
  { id: 'admins', label: 'Админы', test: (u) => u.admin || u.owner },
  { id: 'verified', label: 'С галочкой', test: (u) => u.verified },
  { id: 'banned', label: 'Заблокированы', test: (u) => u.banned },
]

const SORTS: { id: Sort; label: string }[] = [
  { id: 'number', label: 'По номеру' },
  { id: 'newest', label: 'Сначала новые' },
  { id: 'messages', label: 'По сообщениям' },
  { id: 'badges', label: 'По значкам' },
]

const PAGE = 40

interface Props {
  users: AdminUser[]
  filter: PeopleFilter
  onFilter: (f: PeopleFilter) => void
  /** Раскрыть и показать этого человека (переход из «Обзора») */
  focus: string | null
  onFocused: () => void
  onUser: (u: AdminUser) => void
}

/** «Люди»: поиск, галочки, админы, блокировки, привилегии и значки */
export function AdminPeople({ users, filter, onFilter, focus, onFocused, onUser }: Props) {
  const me = useChat((s) => s.me!)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('number')
  const [open, setOpen] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [flash, setFlash] = useState<string | null>(null)

  // Каталог нужен для значков людей и списка «выдать»
  useEffect(() => void loadBadges(), [])

  const q = query.trim().toLowerCase().replace(/^[@#№]\s*/, '')
  const list = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)?.test ?? (() => true)
    const found = users.filter((u) => {
      if (!test(u)) return false
      if (!q) return true
      if (/^\d+$/.test(q) && String(u.number) === q) return true
      return u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)
    })
    const by: Record<Sort, (a: AdminUser, b: AdminUser) => number> = {
      number: (a, b) => a.number - b.number,
      newest: (a, b) => b.number - a.number,
      messages: (a, b) => (b.stats?.messages ?? 0) - (a.stats?.messages ?? 0),
      badges: (a, b) => (b.badges?.length ?? 0) - (a.badges?.length ?? 0),
    }
    return found.sort(by[sort])
  }, [users, filter, q, sort])

  // Переход из «Обзора»: сбрасываем поиск, раскрываем человека и прокручиваем к нему
  useEffect(() => {
    if (!focus) return
    setQuery('')
    onFilter('all')
    setOpen(focus)
    setFlash(focus)
    onFocused()
  }, [focus, onFilter, onFocused])

  useLayoutEffect(() => {
    if (!flash) return
    const idx = list.findIndex((u) => u.id === flash)
    if (idx >= limit) return setLimit(idx + 1)
    document.getElementById(`adm-p-${flash}`)?.scrollIntoView({ block: 'center', behavior: calmMotion() ? 'auto' : 'smooth' })
    const t = window.setTimeout(() => setFlash(null), 1600)
    return () => window.clearTimeout(t)
  }, [flash, list, limit])

  return (
    <div className="adm-people">
      <div className="adm-toolbar">
        <label className="adm-search">
          <Search size={15} />
          <input
            className="input"
            value={query}
            placeholder="Имя, логин, почта или №"
            onChange={(e) => {
              setQuery(e.target.value)
              setLimit(PAGE)
            }}
          />
          {query && (
            <button className="adm-search__clear" onClick={() => setQuery('')} aria-label="Очистить">
              <X size={14} />
            </button>
          )}
        </label>
        <span className="select adm-sort">
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Порядок">
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="adm-chips" role="tablist">
        {FILTERS.map((f) => {
          const n = users.filter(f.test).length
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={`adm-chip${filter === f.id ? ' is-active' : ''}`}
              onClick={() => {
                onFilter(f.id)
                setLimit(PAGE)
              }}
            >
              {f.label}
              <span className="adm-chip__n">{n}</span>
            </button>
          )
        })}
      </div>

      {list.length === 0 && <div className="adm-empty">{q ? `Никого не нашлось по «${query.trim()}»` : 'Здесь пока пусто'}</div>}

      <div className="adm-people__list">
        {list.slice(0, limit).map((u, i) => (
          <Person
            key={u.id}
            user={u}
            me={me}
            index={i}
            open={open === u.id}
            flash={flash === u.id}
            onToggle={() => setOpen((cur) => (cur === u.id ? null : u.id))}
            onUser={onUser}
          />
        ))}
      </div>

      {list.length > limit && (
        <button className="btn btn--ghost btn--sm adm-more" onClick={() => setLimit((l) => l + PAGE)}>
          Показать ещё {Math.min(PAGE, list.length - limit)} из {list.length - limit}
        </button>
      )}
    </div>
  )
}

interface PersonProps {
  user: AdminUser
  me: Me
  index: number
  open: boolean
  flash: boolean
  onToggle: () => void
  onUser: (u: AdminUser) => void
}

function Person({ user: u, me, index, open, flash, onToggle, onUser }: PersonProps) {
  const presence = presenceOfAdmin(u)
  const statusText = !u.online ? 'не в сети' : u.status === 'invisible' ? 'невидимка' : (STATUS_LABEL[u.status] ?? 'в сети').toLowerCase()

  return (
    <div
      id={`adm-p-${u.id}`}
      className={`adm-person${open ? ' is-open' : ''}${u.banned ? ' is-banned' : ''}${flash ? ' is-flash' : ''}`}
      style={{ animationDelay: `${Math.min(index, 14) * 30}ms` }}
    >
      <button className="adm-person__row" onClick={onToggle} aria-expanded={open}>
        <Avatar user={u} size={38} status={presence} />
        <span className="adm-person__who">
          <span className="adm-person__name">
            <span className="truncate">{u.displayName}</span>
            <UserTags user={u} size={14} />
            {u.owner ? (
              <span className="adm-role" data-tip="Владелец Nuntius">
                <Crown size={13} />
              </span>
            ) : (
              u.admin && (
                <span className="adm-role" data-tip="Админ">
                  <Shield size={13} />
                </span>
              )
            )}
            {u.id === me.id && <span className="adm-flag">это ты</span>}
            {u.banned && <span className="adm-flag adm-flag--ban">Заблокирован</span>}
          </span>
          <span className="adm-person__sub truncate">
            @{u.username}
            {u.email ? ` · ${u.email}` : ' · без почты'}
          </span>
        </span>
        <span className="adm-person__meta">
          <span className={`adm-dot${u.online ? ' is-on' : ''}`} data-tip={statusText} />
          <span className="adm-person__num">№ {u.number}</span>
          <span className="adm-person__date">{shortDate.format(u.createdAt)}</span>
        </span>
        <ChevronDown size={16} className="adm-person__chev" />
      </button>
      {open && <PersonPanel user={u} me={me} onUser={onUser} />}
    </div>
  )
}

/** Секунды → «2 ч 15 мин» */
function duration(sec: number) {
  if (!sec) return '0 мин'
  if (sec < 60) return `${Math.round(sec)} с`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h ? `${fmtNum(h)} ч${m ? ` ${m} мин` : ''}` : `${m} мин`
}

function PersonPanel({ user: u, me, onUser }: { user: AdminUser; me: Me; onUser: (u: AdminUser) => void }) {
  const catalog = useBadges((s) => s.catalog)
  const [confirmBan, setConfirmBan] = useState(false)
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const latest = useRef(u)
  latest.current = u

  // «Точно убрать?» сам гаснет через пару секунд
  useEffect(() => {
    if (!revoking) return
    const t = window.setTimeout(() => setRevoking(null), 3000)
    return () => window.clearTimeout(t)
  }, [revoking])

  const isSelf = u.id === me.id
  const ownerLocked = u.owner && !me.owner
  const canAdmin = me.owner && !u.owner
  const canBan = !u.owner && !isSelf && (!u.admin || me.owner)
  const adminHint = u.owner ? 'Владелец приложения — админ навсегда' : !me.owner ? 'Назначать админов может только владелец' : 'Откроет эту админку'
  const banHint = u.owner
    ? 'Владельца заблокировать нельзя'
    : isSelf
      ? 'Себя заблокировать нельзя'
      : u.admin && !me.owner
        ? 'Админа может заблокировать только владелец'
        : u.banned
          ? 'Не может войти в Nuntius'
          : 'Не сможет войти, все сессии закроются'

  /** Сразу показываем, сервер догонит; ошибка — откатываем */
  const patch = async (p: AdminUserPatch, optimistic: Partial<AdminUser>) => {
    const before = latest.current
    onUser({ ...before, ...optimistic })
    try {
      onUser((await api.adminUpdateUser(before.id, p)).user)
    } catch (err) {
      onUser(before)
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
  }

  const setPrivilege = (key: 'createServers' | 'createGroups', value: boolean) =>
    void patch({ privileges: { [key]: value } }, { privileges: { ...latest.current.privileges, [key]: value } })

  const ban = (value: boolean) => {
    if (value && !confirmBan) return setConfirmBan(true)
    setConfirmBan(false)
    void patch({ banned: value }, { banned: value, online: value ? false : latest.current.online })
  }

  const held = new Set((u.badges ?? []).map((b) => b.id))
  const defOf = (id: string) => badgeDef(id, catalog) ?? unknownBadge(id)
  const label = (b: BadgeDef) => (b.name === '???' ? `??? · ${b.id}` : b.name)

  // Сначала ручные (для них админка и нужна), потом остальные по разделам
  const options = catalog
    ? [
        { label: 'Особые — только вручную', list: catalog.badges.filter((b) => b.manual && !held.has(b.id)) },
        ...GROUPS.map((g) => ({ label: g.label, list: catalog.badges.filter((b) => !b.manual && b.group === g.id && !held.has(b.id)) })),
      ].filter((g) => g.list.length)
    : []

  const grant = async () => {
    if (!pick) return
    setBusy(true)
    const before = latest.current
    onUser({ ...before, badges: [...(before.badges ?? []), { id: pick, at: Date.now() }] })
    try {
      onUser((await api.adminGrantBadge(before.id, pick)).user)
      chat.toast({ title: 'Значок выдан', text: `${label(defOf(pick))} → ${before.displayName}` })
      setPick('')
    } catch (err) {
      onUser(before)
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
    setBusy(false)
  }

  const revoke = async (id: string) => {
    if (revoking !== id) return setRevoking(id)
    setRevoking(null)
    const before = latest.current
    onUser({ ...before, badges: (before.badges ?? []).filter((b) => b.id !== id) })
    try {
      onUser((await api.adminRevokeBadge(before.id, id)).user)
    } catch (err) {
      onUser(before)
      chat.toast({ title: 'Не получилось', text: errorText(err) })
    }
  }

  const s = u.stats
  const facts: [string, string][] = [
    ['Сообщений', fmtNum(s?.messages ?? 0)],
    ['В голосе', duration(s?.voiceSeconds ?? 0)],
    ['Рекорд подряд', duration(s?.longestVoice ?? 0)],
    ['Звонков', fmtNum(s?.calls ?? 0)],
    ['Команд', fmtNum(s?.commands ?? 0)],
    ['Пасхалок', fmtNum(u.eggsFound ?? 0)],
  ]

  const copyId = () => {
    void navigator.clipboard?.writeText(u.id).then(
      () => chat.toast({ title: 'id скопирован', text: u.id }),
      () => {},
    )
  }

  return (
    <div className="adm-panel">
      <div className="adm-panel__facts">
        {facts.map(([k, v]) => (
          <div key={k} className="adm-fact">
            <span className="adm-fact__v">{v}</span>
            <span className="adm-fact__k">{k}</span>
          </div>
        ))}
      </div>

      <div className="adm-panel__line">
        <span>
          В Nuntius с {formatDay(u.createdAt)} · № {u.number}
        </span>
        <button className="adm-id" onClick={copyId} data-tip="Скопировать id">
          {u.id.slice(0, 8)}…
        </button>
        {!isSelf && (
          <button
            className="btn btn--ghost btn--sm adm-panel__dm"
            onClick={() => {
              ui.closeSettings()
              void openDmWith(u.id)
            }}
          >
            <MessageCircle size={14} /> Написать
          </button>
        )}
      </div>

      <div className="adm-panel__cols">
        <div className="adm-panel__block">
          <h5 className="adm-panel__title">Права в Nuntius</h5>
          <Toggle
            label="Галочка"
            hint="Белая галочка у имени: «это правда он»"
            checked={u.verified}
            onChange={(v) => void patch({ verified: v }, { verified: v })}
          />
          <Toggle label="Админ" hint={adminHint} checked={u.admin || u.owner} disabled={!canAdmin} onChange={(v) => void patch({ admin: v }, { admin: v })} />
          <Toggle label="Заблокирован" hint={banHint} checked={u.banned} disabled={!canBan} onChange={ban} />
          {confirmBan && (
            <div className="adm-confirm">
              <span>
                Заблокировать <b>{u.displayName}</b>? Его выкинет из всех вкладок.
              </span>
              <button className="btn btn--ghost btn--sm" onClick={() => setConfirmBan(false)}>
                Отмена
              </button>
              <button className="btn btn--primary btn--sm" onClick={() => ban(true)}>
                Заблокировать
              </button>
            </div>
          )}
          <Toggle
            label="Может создавать серверы"
            hint={ownerLocked ? 'Владельцу можно всё' : undefined}
            checked={u.privileges?.createServers !== false}
            disabled={ownerLocked}
            onChange={(v) => setPrivilege('createServers', v)}
          />
          <Toggle
            label="Может создавать группы"
            hint={ownerLocked ? 'Владельцу можно всё' : undefined}
            checked={u.privileges?.createGroups !== false}
            disabled={ownerLocked}
            onChange={(v) => setPrivilege('createGroups', v)}
          />
        </div>

        <div className="adm-panel__block">
          <h5 className="adm-panel__title">
            Значки <span className="adm-panel__count">{u.badges?.length ?? 0}</span>
          </h5>
          {(u.badges?.length ?? 0) === 0 ? (
            <p className="adm-panel__empty">Пока ни одного. Самое время выдать первый ✦</p>
          ) : (
            <div className="adm-badges">
              {(u.badges ?? []).map((b, i) => {
                const def = defOf(b.id)
                const asking = revoking === b.id
                return (
                  <span
                    key={b.id}
                    className={`adm-badge${asking ? ' is-asking' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                    title={`${TIER_LABEL[def.tier]} · получен ${formatDay(b.at)}`}
                  >
                    <BadgeIcon def={def} size={20} />
                    <span className="adm-badge__name truncate">{label(def)}</span>
                    <button className="adm-badge__x" onClick={() => void revoke(b.id)} aria-label={`Забрать «${def.name}»`}>
                      {asking ? 'забрать?' : <X size={13} />}
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          <div className="adm-grant">
            <span className="select">
              <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!catalog || busy} aria-label="Значок">
                <option value="">{catalog ? (options.length ? 'Выбери значок…' : 'Уже есть все значки') : 'Загружаем каталог…'}</option>
                {options.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.list.map((b) => (
                      <option key={b.id} value={b.id}>
                        {label(b)} · {TIER_LABEL[b.tier].toLowerCase()}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </span>
            <button className="btn btn--primary btn--sm" disabled={!pick || busy} onClick={() => void grant()}>
              <Gift size={14} /> Выдать
            </button>
          </div>
          {pick && catalog && <GrantPreview def={defOf(pick)} />}
          <p className="adm-panel__hint">
            {u.online ? 'Сразу увидит праздник «Новый значок!»' : 'Сейчас не в сети — значок просто появится в профиле'}
            {' · '}
            {plural(u.badges?.length ?? 0, ['значок', 'значка', 'значков'])}
          </p>
        </div>
      </div>
    </div>
  )
}

function GrantPreview({ def }: { def: BadgeDef }) {
  return (
    <div className="adm-preview" key={def.id}>
      <BadgeIcon def={def} size={40} />
      <span className="adm-preview__text">
        <b>{def.name}</b>
        <span>{def.description}</span>
      </span>
    </div>
  )
}
