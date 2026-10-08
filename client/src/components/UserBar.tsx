import { useEffect, useRef, useState } from 'react'
import { Check, Headphones, HeadphoneOff, LogOut, Mic, MicOff, Pencil, Settings as SettingsIcon, X } from 'lucide-react'
import { api, ApiError, type Status } from '../lib/api'
import { selfAvatarClick } from '../lib/eggs'
import { STATUS_LABEL, STATUS_OPTIONS, selfPresence } from '../lib/status'
import { useSettings } from '../lib/settings'
import { toggleDeafen, toggleMute, useVoice } from '../lib/voice'
import { chat, useChat } from '../lib/store'
import { ui, useUi } from '../lib/ui'
import { Avatar } from './Avatar'
import { StatusIcon } from './StatusIcon'
import { BadgeRow } from './badges/BadgeRow'

/** Панель «я» слева внизу: открывает карточку профиля со статусами, рядом — микрофон, звук, настройки */
export function UserBar({ onLogout }: { onLogout: () => void }) {
  const me = useChat((s) => s.me!)
  const open = useUi((s) => s.statusMenuOpen)
  const muted = useSettings((s) => s.muted)
  const deafened = useSettings((s) => s.deafened)
  const noMic = useVoice((s) => s.noMic && s.roomId !== null)
  // Как в голосовой панели: при выключенном звуке микрофон тоже выключен
  const micOff = muted || deafened || noMic
  const rootRef = useRef<HTMLDivElement>(null)
  // пасхалка «Голова кружится»: 5 быстрых кликов по своей аватарке
  const [dizzy, setDizzy] = useState(0)

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
      {open && <SelfPopout onLogout={onLogout} />}
      <button className={`userbar__me${open ? ' is-open' : ''}`} onClick={() => ui.setStatusMenu(!open)} aria-expanded={open}>
        <span
          key={dizzy}
          className={`userbar__avatar${dizzy ? ' egg-dizzy' : ''}`}
          onClick={() => selfAvatarClick() && setDizzy((n) => n + 1)}
        >
          <Avatar user={me} size={36} status={selfPresence(me.status)} />
        </span>
        <span className="userbar__names">
          <span className="userbar__name truncate">{me.displayName}</span>
          <span className="userbar__status truncate">{me.customStatus || STATUS_LABEL[me.status]}</span>
        </span>
      </button>
      <div className="userbar__actions">
        <button
          className={`icon-btn${micOff ? ' is-on' : ''}`}
          onClick={toggleMute}
          data-tip={micOff ? 'Включить микрофон' : 'Выключить микрофон'}
          aria-pressed={micOff}
        >
          {micOff ? <MicOff size={17} /> : <Mic size={17} />}
        </button>
        <button
          className={`icon-btn${deafened ? ' is-on' : ''}`}
          onClick={toggleDeafen}
          data-tip={deafened ? 'Включить звук' : 'Выключить звук'}
          aria-pressed={deafened}
        >
          {deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
        </button>
        <button className="icon-btn icon-btn--gear" onClick={() => ui.openSettings()} data-tip="Настройки" aria-label="Настройки">
          <SettingsIcon size={17} />
        </button>
      </div>
    </div>
  )
}

/** Своя карточка: превью профиля, свой статус-текст, выбор статуса, настройки и выход */
function SelfPopout({ onLogout }: { onLogout: () => void }) {
  const me = useChat((s) => s.me!)
  const [custom, setCustom] = useState(me.customStatus)

  const save = async (patch: { status?: Status; customStatus?: string }) => {
    const before = useChat.getState().me!
    chat.setMe({ ...before, ...patch }) // сразу показываем, сервер догонит
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
    <div className="self-popout glow" role="menu">
      <div className="self-popout__banner" />
      <div className="self-popout__head">
        <span className="self-popout__avatar">
          <Avatar user={me} size={64} status={selfPresence(me.status)} ring />
        </span>
        <button className="self-popout__edit" onClick={() => ui.openSettings('profile')} data-tip="Редактировать профиль" aria-label="Редактировать профиль">
          <Pencil size={15} />
        </button>
      </div>
      <div className="self-popout__who">
        <div className="self-popout__name">{me.displayName}</div>
        <div className="self-popout__tag">@{me.username}</div>
        {me.bio && <p className="self-popout__bio">{me.bio}</p>}
        <BadgeRow user={me} max={8} />
      </div>

      <div className="status-menu__custom">
        <input
          className="status-menu__input"
          value={custom}
          maxLength={64}
          placeholder="Чем занят? Напиши статус…"
          onChange={(e) => setCustom(e.target.value)}
          onBlur={saveCustom}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
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

      <div className="self-popout__statuses">
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
              <StatusIcon status={opt.value} size={14} />
            </span>
            <span className="status-option__text">
              <span className="status-option__label">{STATUS_LABEL[opt.value]}</span>
              <span className="status-option__hint">{opt.hint}</span>
            </span>
            {me.status === opt.value && <Check size={16} className="status-option__check" />}
          </button>
        ))}
      </div>

      <div className="status-menu__sep" />
      <button className="status-option" onClick={() => ui.openSettings()}>
        <span className="status-option__icon">
          <SettingsIcon size={15} />
        </span>
        <span className="status-option__label">Настройки</span>
      </button>
      <button className="status-option status-option--danger" onClick={onLogout}>
        <span className="status-option__icon">
          <LogOut size={14} />
        </span>
        <span className="status-option__label">Выйти из аккаунта</span>
      </button>
    </div>
  )
}
