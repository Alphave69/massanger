import { useState, type ReactNode } from 'react'
import { Compass, Download, Plus } from 'lucide-react'
import { sphereTileClick } from '../lib/eggs'
import { initials } from '../lib/format'
import { isInstalledApp } from '../lib/platform'
import { chat, useChat } from '../lib/store'
import { ui } from '../lib/ui'
import { MiniSphere } from './MiniSphere'
import { navigate } from './landing/route'

// В приложении для Windows и на значке с главного экрана скачивать уже нечего
const SHOW_DOWNLOAD = !isInstalledApp()

/** Плавающая колонка слева: «Личное» + серверы */
export function Dock() {
  const view = useChat((s) => s.view)
  const guilds = useChat((s) => s.guilds)
  const unread = useChat((s) => s.unread)
  const dms = useChat((s) => s.dms)
  const requests = useChat((s) => s.friends.filter((f) => f.state === 'incoming').length)

  const homeActive = view.kind === 'home' || view.kind === 'dm'
  const dmUnread = dms.reduce((sum, d) => sum + (unread[d.id] ?? 0), 0)
  const homeBadge = dmUnread + requests
  // пасхалка «Не трогай сферу»: 7 быстрых кликов — сфера взрывается и кружится
  const [burst, setBurst] = useState(0)

  return (
    <nav className="dock glow" aria-label="Навигация">
      <DockItem
        tip="Личное"
        active={homeActive}
        badge={homeBadge}
        onClick={() => {
          chat.setView({ kind: 'home', tab: requests ? 'pending' : 'online' })
          if (sphereTileClick()) setBurst((n) => n + 1)
        }}
        className="dock__tile--home"
      >
        <span key={burst} className={`dock__sphere${burst ? ' egg-burst' : ''}`}>
          <MiniSphere size={30} dots={80} />
        </span>
      </DockItem>

      <div className="dock__sep" />

      <div className="dock__list">
        {guilds.map((g, i) => {
          const hasUnread = g.channels.some((c) => (unread[c.id] ?? 0) > 0)
          return (
            <DockItem
              key={g.id}
              tip={g.name}
              active={view.kind === 'guild' && view.guildId === g.id}
              dot={hasUnread}
              delay={i * 60}
              onClick={() => chat.setView({ kind: 'guild', guildId: g.id })}
            >
              <span className="dock__initials">{initials(g.name)}</span>
            </DockItem>
          )
        })}

        <DockItem tip="Создать сервер" onClick={() => ui.openModal('create-guild')} className="dock__tile--action">
          <Plus size={20} />
        </DockItem>
        <DockItem tip="Войти по приглашению" onClick={() => ui.openModal('join-guild')} className="dock__tile--action">
          <Compass size={20} />
        </DockItem>
      </div>

      {SHOW_DOWNLOAD && (
        <div className="dock__foot">
          <DockItem tip="Скачать приложение" onClick={() => navigate('download')} className="dock__tile--download">
            <Download size={19} />
          </DockItem>
        </div>
      )}
    </nav>
  )
}

interface ItemProps {
  tip: string
  active?: boolean
  badge?: number
  dot?: boolean
  delay?: number
  className?: string
  onClick: () => void
  children: ReactNode
}

function DockItem({ tip, active, badge, dot, delay = 0, className = '', onClick, children }: ItemProps) {
  return (
    <div className={`dock__item${active ? ' is-active' : ''}${dot && !active ? ' has-dot' : ''}`} style={{ animationDelay: `${delay}ms` }}>
      <span className="dock__indicator" />
      <button className={`dock__tile ${className}`} data-tip={tip} aria-label={tip} onClick={onClick}>
        {children}
      </button>
      {!!badge && <span className="dock__badge">{badge > 99 ? '99+' : badge}</span>}
    </div>
  )
}
