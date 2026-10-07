import { Compass, Plus } from 'lucide-react'
import type { Guild } from '../lib/api'
import { initials } from '../lib/format'
import { Logo } from './Logo'

interface Props {
  guilds: Guild[]
  activeGuildId: string | null
  onSelect: (guildId: string) => void
  onCreate: () => void
  onJoin: () => void
}

export function ServerRail({ guilds, activeGuildId, onSelect, onCreate, onJoin }: Props) {
  return (
    <nav className="rail" aria-label="Серверы">
      <div className="rail__item rail__item--home">
        <span className="rail__pill" />
        <button className="rail__btn rail__btn--home" data-tip="Massanger">
          <Logo size={26} />
        </button>
      </div>
      <div className="rail__sep" />

      <div className="rail__list">
        {guilds.map((g, i) => (
          <div
            key={g.id}
            className={`rail__item${g.id === activeGuildId ? ' is-active' : ''}`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <span className="rail__pill" />
            <button className="rail__btn" data-tip={g.name} onClick={() => onSelect(g.id)}>
              {initials(g.name)}
            </button>
          </div>
        ))}

        <div className="rail__item">
          <button className="rail__btn rail__btn--action" data-tip="Создать сервер" onClick={onCreate}>
            <Plus size={22} />
          </button>
        </div>
        <div className="rail__item">
          <button className="rail__btn rail__btn--action" data-tip="Присоединиться" onClick={onJoin}>
            <Compass size={22} />
          </button>
        </div>
      </div>
    </nav>
  )
}
