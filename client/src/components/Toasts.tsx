import { chat, useChat } from '../lib/store'
import { ui } from '../lib/ui'
import { Avatar } from './Avatar'
import { MiniSphere } from './MiniSphere'

/** Стопка уведомлений в правом нижнем углу */
export function Toasts() {
  const toasts = useChat((s) => s.toasts)
  const users = useChat((s) => s.users)

  return (
    <div className="toasts zoomed" aria-live="polite">
      {toasts.map((t) => {
        const user = t.userId ? users[t.userId] : undefined
        return (
          <button
            key={t.id}
            className={`toast glow${t.action ? ' toast--action' : ''}`}
            onClick={() => {
              if (t.action) {
                ui.closeOverlays()
                chat.setView(t.action)
              }
              chat.dismissToast(t.id)
            }}
          >
            <span className="toast__icon">{user ? <Avatar user={user} size={34} /> : <MiniSphere size={28} dots={60} />}</span>
            <span className="toast__text">
              <b className="truncate">{t.title}</b>
              {t.text && <span>{t.text}</span>}
            </span>
            <span className="toast__timer" />
          </button>
        )
      })}
    </div>
  )
}
