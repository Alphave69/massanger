import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Egg, Lock, RefreshCw, ShieldCheck } from 'lucide-react'
import type { BadgeDef, BadgeTier } from '../../lib/api'
import { GROUPS, loadBadges, progressUnit, rarityOf, TIER_LABEL, TIER_RANK, useBadges } from '../../lib/badges'
import { formatDay } from '../../lib/format'
import { useChat } from '../../lib/store'
import { BadgeIcon } from '../badges/BadgeIcon'
import { BadgePopover } from '../badges/BadgePopover'
import { SectionHead } from './controls'

const TIERS: BadgeTier[] = ['legendary', 'epic', 'rare', 'common']
const shortDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

/** Раздел «Значки»: коллекция с прогрессом, секретные «???» и найденные пасхалки */
export function BadgesSection() {
  const me = useChat((s) => s.me!)
  const catalog = useBadges((s) => s.catalog)
  const failed = useBadges((s) => s.failed)
  const [open, setOpen] = useState<{ id: string; el: HTMLElement } | null>(null)

  // Прогресс меняется постоянно — открыли раздел, подтянули свежий
  useEffect(() => void loadBadges(), [])

  const earned = new Map((me.badges ?? []).map((b) => [b.id, b.at]))
  const eggs = me.eggs ?? []
  const eggTotal = Math.max(me.eggTotal ?? 0, catalog?.eggTotal ?? 0, eggs.length)

  // Ручные значки (их выдаёт админ) показываем, только если они уже есть
  const visible = catalog ? catalog.badges.filter((b) => !b.manual || earned.has(b.id)) : []
  const got = visible.filter((b) => earned.has(b.id))
  const rarest = got.reduce<{ def: BadgeDef; pct: number } | null>((best, def) => {
    const r = rarityOf(def.id, catalog, true)
    if (!r) return best
    // Среди одинаково редких — более ценный
    if (!best || r.pct < best.pct || (r.pct === best.pct && TIER_RANK[def.tier] > TIER_RANK[best.def.tier])) return { def, pct: r.pct }
    return best
  }, null)

  const toggle = (id: string, el: HTMLElement) => setOpen((cur) => (cur?.id === id ? null : { id, el }))

  return (
    <>
      <SectionHead title="Значки" subtitle="Награды за время в Nuntius, сообщения, голос, друзей и находки. Нажми на значок — расскажем подробнее." />

      <div className="bdg-summary">
        <Meter label="Получено" value={got.length} total={visible.length} loading={!catalog} />
        <Meter label="Пасхалки" value={eggs.length} total={eggTotal} icon={<Egg size={14} />} />
        {catalog && (
          <div className="bdg-summary__tiers">
            {TIERS.map((t) => {
              const n = got.filter((b) => b.tier === t).length
              return (
                <span key={t} className={`bdg-summary__tier${n ? '' : ' is-zero'}`} data-tip={TIER_LABEL[t]}>
                  <span className={`bdg-gem bdg-gem--${t}`} />
                  {n}
                </span>
              )
            })}
            {rarest && (
              <button className="bdg-summary__rarest" onClick={(e) => toggle(rarest.def.id, e.currentTarget)}>
                <BadgeIcon def={rarest.def} size={22} />
                <span className="truncate">
                  Самый редкий: <b>{rarest.def.name}</b>
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {!catalog ? (
        failed ? (
          <div className="notice notice--error bdg-failed">
            Не получилось загрузить значки
            <button className="btn btn--outline btn--sm" onClick={() => void loadBadges(true)}>
              <RefreshCw size={14} /> Ещё раз
            </button>
          </div>
        ) : (
          <div className="bdg-grid">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="bdg-card bdg-card--skeleton" style={{ animationDelay: `${i * 60}ms` }}>
                <span className="bdg-skel" />
                <span className="bdg-skel bdg-skel--line" />
              </div>
            ))}
          </div>
        )
      ) : (
        GROUPS.map((g) => {
          const list = visible.filter((b) => b.group === g.id)
          if (!list.length) return null
          const have = list.filter((b) => earned.has(b.id)).length
          return (
            <section key={g.id} className="set-group bdg-group">
              <h3 className="set-group__title">
                {g.label}
                <span className="bdg-group__count">
                  {have} / {list.length}
                </span>
              </h3>
              {g.id === 'special' && (
                <p className="bdg-group__note">
                  <ShieldCheck size={13} /> Особые значки выдаёт администрация — за помощь, баги и просто так.
                </p>
              )}
              <div className="bdg-grid">
                {list.map((def, i) => (
                  <BadgeCard
                    key={def.id}
                    def={def}
                    index={i}
                    at={earned.get(def.id)}
                    progress={catalog.progress[def.id]}
                    pct={rarityOf(def.id, catalog, earned.has(def.id))?.pct}
                    open={open?.id === def.id}
                    onOpen={(el) => toggle(def.id, el)}
                  />
                ))}
              </div>
            </section>
          )
        })
      )}

      <section className="set-group bdg-group">
        <h3 className="set-group__title">
          Найденные пасхалки
          <span className="bdg-group__count">
            {eggs.length} / {eggTotal || '?'}
          </span>
        </h3>
        <p className="bdg-group__note">
          {eggTotal && eggs.length >= eggTotal
            ? 'Ты нашёл(ла) всё, что мы спрятали. Почти всё ✦'
            : 'Секреты спрятаны по всему Nuntius: в чате, в голосе, в настройках… Ищи!'}
        </p>
        <div className="bdg-eggs">
          {eggs.map((e, i) => (
            <div key={e.id} className="bdg-egg is-found" style={{ animationDelay: `${Math.min(i, 20) * 35}ms` }}>
              <span className="bdg-egg__icon">
                <Egg size={15} />
              </span>
              <span className="bdg-egg__name truncate">{e.name}</span>
              <time className="bdg-egg__date">{shortDate.format(e.at)}</time>
            </div>
          ))}
          {Array.from({ length: Math.max(0, eggTotal - eggs.length) }, (_, i) => (
            <div
              key={`?${i}`}
              className="bdg-egg is-hidden"
              style={{ animationDelay: `${Math.min(eggs.length + i, 20) * 35}ms` }}
              aria-label="Ещё не найдена"
            >
              <span className="bdg-egg__icon">
                <Egg size={15} />
              </span>
              <span className="bdg-egg__name">???</span>
            </div>
          ))}
        </div>
      </section>

      {open && <BadgePopover badgeId={open.id} earnedAt={earned.get(open.id)} self anchor={open.el} onClose={() => setOpen(null)} />}
    </>
  )
}

function Meter({ label, value, total, icon, loading }: { label: string; value: number; total: number; icon?: ReactNode; loading?: boolean }) {
  const pct = total ? Math.min(100, (value / total) * 100) : 0
  const done = total > 0 && value >= total
  return (
    <div className={`bdg-meter${done ? ' is-done' : ''}`}>
      <div className="bdg-meter__top">
        <span className="bdg-meter__label">
          {icon}
          {label}
        </span>
        <span className="bdg-meter__value">
          {loading ? '…' : value}
          <small> из {loading ? '…' : total}</small>
        </span>
      </div>
      <div className="bdg-bar bdg-bar--big">
        <span style={{ width: `${loading ? 0 : pct}%` }} />
      </div>
      <span className="bdg-meter__pct">{loading ? 'считаем…' : done ? 'Всё собрано ✦' : `${Math.floor(pct)}%`}</span>
    </div>
  )
}

interface CardProps {
  def: BadgeDef
  index: number
  at?: number
  progress?: { current: number; target: number }
  pct?: number
  open: boolean
  onOpen: (el: HTMLElement) => void
}

function BadgeCard({ def, index, at, progress, pct, open, onOpen }: CardProps) {
  const earned = at !== undefined
  const hiddenSecret = def.secret && !earned
  const part = progress && progress.target > 0 ? Math.min(1, progress.current / progress.target) : null
  return (
    <button
      className={`bdg-card bdg-card--${def.tier}${earned ? ' is-earned' : ' is-locked'}${hiddenSecret ? ' is-secret' : ''}${open ? ' is-open' : ''}`}
      style={{ animationDelay: `${Math.min(index, 16) * 40}ms` } as CSSProperties}
      onClick={(e) => onOpen(e.currentTarget)}
      aria-expanded={open}
    >
      {pct !== undefined && (
        <span className="bdg-card__pct" data-tip={`Есть у ${pct < 1 && pct > 0 ? 'меньше 1' : Math.round(pct)}% людей`}>
          {pct > 0 && pct < 1 ? '<1' : Math.round(pct)}%
        </span>
      )}
      <span className="bdg-card__icon">
        <BadgeIcon def={def} size={46} locked={!earned} />
        {!earned && (
          <span className="bdg-card__lock">
            <Lock size={10} />
          </span>
        )}
      </span>
      <span className="bdg-card__name">{def.name}</span>
      {earned ? (
        <span className="bdg-card__sub">{formatDay(at)}</span>
      ) : part !== null && progress ? (
        <span className="bdg-card__progress">
          <span className="bdg-bar">
            <span style={{ width: `${part * 100}%` }} />
          </span>
          <span className="bdg-card__count">
            {Math.min(progress.current, progress.target)} / {progress.target}
            {progressUnit(def.id)}
          </span>
        </span>
      ) : (
        <span className="bdg-card__sub bdg-card__sub--desc">{hiddenSecret ? 'Секретный значок' : def.description}</span>
      )}
      <span className={`bdg-card__tier bdg-card__tier--${def.tier}`}>{TIER_LABEL[def.tier]}</span>
    </button>
  )
}
