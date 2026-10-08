import { useEffect, useState, type CSSProperties } from 'react'
import type { User } from '../../lib/api'
import { plural } from '../../lib/format'
import { badgeDef, loadBadges, unknownBadge, useBadges } from '../../lib/badges'
import { useChat } from '../../lib/store'
import { BadgeIcon } from './BadgeIcon'
import { BadgePopover } from './BadgePopover'

const SIZE = 22

/**
 * Строка значков человека (в профиле, в своей карточке). Клик по значку — подробности.
 * Порядок — как прислал сервер: сначала самые ценные, среди равных — самые ранние.
 */
export function BadgeRow({ user, max }: { user: User; max?: number }) {
  const catalog = useBadges((s) => s.catalog)
  const meId = useChat((s) => s.me?.id)
  const [open, setOpen] = useState<{ id: string; at: number; el: HTMLElement } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const badges = user.badges ?? []

  // Иконки и названия — из каталога: подтягиваем один раз (дальше он в кэше)
  useEffect(() => {
    if (badges.length && !useBadges.getState().catalog) void loadBadges()
  }, [badges.length])

  // Значок забрали (админ), пока была открыта карточка
  useEffect(() => {
    if (open && !badges.some((b) => b.id === open.id)) setOpen(null)
  }, [badges, open])

  if (!badges.length) return null

  const limit = max && !expanded && badges.length > max ? max - 1 : badges.length
  const shown = badges.slice(0, limit)
  const hidden = badges.length - shown.length

  return (
    <div className="bdg-row" aria-label={plural(badges.length, ['значок', 'значка', 'значков'])}>
      {shown.map((b, i) => {
        const def = badgeDef(b.id, catalog) ?? (catalog ? unknownBadge(b.id) : null)
        const isOpen = open?.id === b.id
        return (
          <button
            key={b.id}
            className={`bdg-row__item${isOpen ? ' is-open' : ''}`}
            style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
            data-tip={isOpen ? undefined : (def?.name ?? 'Значок')}
            aria-label={def?.name ?? 'Значок'}
            aria-expanded={isOpen}
            onClick={(e) => {
              const el = e.currentTarget
              setOpen((cur) => (cur?.id === b.id ? null : { id: b.id, at: b.at, el }))
            }}
          >
            {def ? <BadgeIcon def={def} size={SIZE} /> : <span className="bdg bdg--ghost" style={{ '--s': `${SIZE}px` } as CSSProperties} />}
          </button>
        )
      })}
      {hidden > 0 && (
        <button className="bdg-row__more" onClick={() => setExpanded(true)} data-tip={`Ещё ${plural(hidden, ['значок', 'значка', 'значков'])}`}>
          +{hidden}
        </button>
      )}
      {expanded && max && badges.length > max && (
        <button className="bdg-row__more bdg-row__more--less" onClick={() => setExpanded(false)} data-tip="Свернуть" aria-label="Свернуть">
          ‹
        </button>
      )}
      {open && <BadgePopover badgeId={open.id} earnedAt={open.at} self={user.id === meId} anchor={open.el} onClose={() => setOpen(null)} />}
    </div>
  )
}
