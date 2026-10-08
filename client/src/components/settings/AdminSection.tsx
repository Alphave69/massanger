import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { LayoutGrid, LoaderCircle, Megaphone, RefreshCw, Server, Users } from 'lucide-react'
import { api, type AdminOverview as Overview, type AdminUser } from '../../lib/api'
import { useChat } from '../../lib/store'
import { AdminAnnounce } from '../admin/AdminAnnounce'
import { AdminOverview } from '../admin/AdminOverview'
import { AdminPeople, type PeopleFilter } from '../admin/AdminPeople'
import { AdminServers } from '../admin/AdminServers'
import { errorText } from '../admin/bits'
import { SectionHead } from './controls'

type Tab = 'overview' | 'people' | 'servers' | 'announce'

const TABS: { id: Tab; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'overview', label: 'Обзор', icon: LayoutGrid },
  { id: 'people', label: 'Люди', icon: Users },
  { id: 'servers', label: 'Серверы', icon: Server },
  { id: 'announce', label: 'Объявление', icon: Megaphone },
]

/** Пока админка открыта, цифры тихо обновляются */
const REFRESH_MS = 30_000

/** Раздел «Админка» (только для админов приложения): цифры, люди, серверы, объявления */
export function AdminSection() {
  const me = useChat((s) => s.me!)
  const [tab, setTab] = useState<Tab>('overview')
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<PeopleFilter>('all')
  const [focus, setFocus] = useState<string | null>(null)
  const [spin, setSpin] = useState(0)
  const alive = useRef(true)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const next = await api.adminOverview()
      if (!alive.current) return
      setData(next)
      setError(null)
    } catch (err) {
      if (alive.current && !quiet) setError(errorText(err))
    }
    if (alive.current) setLoading(false)
  }, [])

  useEffect(() => {
    alive.current = true
    void load()
    const t = window.setInterval(() => !document.hidden && void load(true), REFRESH_MS)
    return () => {
      alive.current = false
      window.clearInterval(t)
    }
  }, [load])

  // Ответ сервера по одному человеку — заменяем его в списке
  const onUser = useCallback((u: AdminUser) => {
    setData((d) => (d ? { ...d, users: d.users.map((x) => (x.id === u.id ? { ...x, ...u } : x)) } : d))
  }, [])

  const onGuildDeleted = useCallback((id: string) => {
    setData((d) => (d ? { ...d, guilds: d.guilds.filter((g) => g.id !== id), stats: { ...d.stats, guilds: Math.max(0, d.stats.guilds - 1) } } : d))
  }, [])

  const goPeople = useCallback((f: PeopleFilter) => {
    setFilter(f)
    setTab('people')
  }, [])

  const goPerson = useCallback((id: string) => {
    setFocus(id)
    setTab('people')
  }, [])

  const onFocused = useCallback(() => setFocus(null), [])

  const refresh = () => {
    setSpin((n) => n + 1)
    void load()
  }

  return (
    <>
      <SectionHead
        title="Админка"
        subtitle={me.owner ? 'Ты владелец Nuntius: тебе можно всё, даже назначать админов.' : 'Ты админ Nuntius. Береги людей и порядок ✦'}
      />

      <div className="adm-tabs">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon size={15} />
              {t.label}
              {t.id === 'people' && data && <span className="adm-tabs__n">{data.users.length}</span>}
              {t.id === 'servers' && data && <span className="adm-tabs__n">{data.guilds.length}</span>}
            </button>
          ))}
        </div>
        <button className="icon-btn adm-refresh" onClick={refresh} disabled={loading} data-tip="Обновить" aria-label="Обновить">
          <RefreshCw size={16} key={spin} className={spin ? 'adm-refresh__spin' : undefined} />
        </button>
      </div>

      {error && !data && (
        <div className="notice notice--error">
          {error}
          <button className="btn btn--outline btn--sm" onClick={() => void load()}>
            <RefreshCw size={14} /> Ещё раз
          </button>
        </div>
      )}

      {!data ? (
        !error && (
          <div className="adm-loading">
            <LoaderCircle size={20} className="spin" /> Собираем цифры…
          </div>
        )
      ) : (
        <div className="adm-body" key={tab}>
          {tab === 'overview' && <AdminOverview data={data} onPeople={goPeople} onServers={() => setTab('servers')} onPerson={goPerson} />}
          {tab === 'people' && (
            <AdminPeople users={data.users} filter={filter} onFilter={setFilter} focus={focus} onFocused={onFocused} onUser={onUser} />
          )}
          {tab === 'servers' && <AdminServers guilds={data.guilds} users={data.users} onDeleted={onGuildDeleted} />}
          {tab === 'announce' && <AdminAnnounce online={data.stats.online} />}
        </div>
      )}
    </>
  )
}
