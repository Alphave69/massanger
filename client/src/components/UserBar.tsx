import { useEffect, useRef, useState } from 'react'
import { Check, Headphones, HeadphoneOff, LogOut, Mic, MicOff, X } from 'lucide-react'
import { api, ApiError, type Status } from '../lib/api'
import { STATUS_LABEL, STATUS_OPTIONS, selfPresence } from '../lib/status'
import { chat, useChat } from '../lib/store'
import { ui, useUi } from '../lib/ui'
import { Avatar } from './Avatar'
import { StatusIcon } from './StatusIcon'

export function UserBar({ onLogout }: { onLogout: () => void }) {
  const me = useChat((s) => s.me)!
  const open = useUi((s) => s.statusMenuOpen)
  const [muted, setMuted] = useState(false)
  const [deaf, setDeaf] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) ui.setStatusMenu(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.setStatusMenu(false)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="userbar" ref={rootRef}>
      {open && <StatusMenu onLogout={onLogout} />}
      <button className={`userbar__me${open ? ' is-open' : ''}`} onClick={() => ui.setStatusMenu(!open)} aria-expanded={open}>
        <Avatar user={me} size={36} status={selfPresence(me.status)} />
        <span className="userbar__names">
          <span className="userbar__name truncate">{me.displayName}</span>
          <span className="userbar__status truncate">{me.customStatus || STATUS_LABEL[me.status]}</span>
        </span>
      </button>
      <div className="userbar__actions">
        <button className={`icon-btn${muted ? ' is-on' : ''}`} onClick={() => setMuted((v) => !v)} data-tip={muted ? 'Включить микрофон' : 'Выключить микрофон'}>
          {muted ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
        <button className={`icon-btn${deaf ? ' is-on' : ''}`} onClick={() => setDeaf((v) => !v)} data-tip={deaf ? 'Включить звук' : 'Выключить звук'}>
          {deaf ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
        </button>
      </div>
    </div>
  )
}

function StatusMenu({ onLogout }: { onLogout: () => void }) {
  const me = useChat((s) => s.me)!
  const [custom, setCustom] = useState(me.customStatus)

  const save = async (patch: { status?: Status; customStatus?: string }) => {
    const before = me
    chat.setMe({ ...me, ...patch }) // сразу показываем, сервер догонит
    try {
      chat.setMe((await api.updateMe(patch)).user)
    } catch (err) {
      chat.setMe(before)
      chat.toast({ title: 'Не сохранилось', text: err instanceof ApiError ? err.message : 'Попробуй ещё раз' })
    }
  }

  const saveCustom = () => {
    if (custom.trim() !== me.customStatus) void save({ customStatus: custom.trim() })
  }

  return (
    <div className="status-menu glow" role="menu">
      <div className="status-menu__head">
        <span className="label">Статус</span>
      </div>

      <div className="status-menu__custom">
        <input
          className="status-menu__input"
          value={custom}
          maxLength={64}
          placeholder="Чем занят? Напиши статус…"
          onChange={(e) => setCustom(e.target.value)}
          onBlur={saveCustom}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), saveCustom())}
        />
        {custom && (
          <button
            className="status-menu__clear"
            aria-label="Очистить"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setCustom('')
              void save({ customStatus: '' })
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {STATUS_OPTIONS.map((opt, i) => (
        <button
          key={opt.value}
          role="menuitemradio"
          aria-checked={me.status === opt.value}
          className={`status-option${me.status === opt.value ? ' is-active' : ''}`}
          style={{ animationDelay: `${i * 35}ms` }}
          onClick={() => {
            void save({ status: opt.value })
            ui.setStatusMenu(false)
          }}
        >
          <span className="status-option__icon">
            <StatusIcon status={opt.value === 'invisible' ? 'invisible' : opt.value} size={14} />
          </span>
          <span className="status-option__text">
            <span className="status-option__label">{STATUS_LABEL[opt.value]}</span>
            <span className="status-option__hint">{opt.hint}</span>
          </span>
          {me.status === opt.value && <Check size={16} className="status-option__check" />}
        </button>
      ))}

      <div className="status-menu__sep" />
      <button className="status-option status-option--danger" onClick={onLogout}>
        <span className="status-option__icon">
          <LogOut size={14} />
        </span>
        <span className="status-option__label">Выйти из аккаунта</span>
      </button>
    </div>
  )
}
