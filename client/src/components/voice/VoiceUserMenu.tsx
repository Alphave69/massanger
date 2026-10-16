import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, MessageCircle, Mic, MicOff, MonitorUp, PhoneOff, Shield, UserMinus, UserRound, Volume2, VolumeX } from 'lucide-react'
import { openDmWith } from '../../lib/actions'
import { api, ApiError } from '../../lib/api'
import { useIsMobile } from '../../lib/mobile'
import { useSheetSwipe } from '../../lib/swipe'
import { can, guildOfChannel, outranks } from '../../lib/perms'
import { uiZoom } from '../../lib/settings'
import { chat, useChat } from '../../lib/store'
import { useUi } from '../../lib/ui'
import { moderateVoice, setScreenVolume, setUserVolume, toggleLocalMute, toggleScreenMute, useVoice } from '../../lib/voice'
import { useVoiceMenu, voiceMenu, type VoiceMenuState } from '../../lib/voiceMenu'
import { Avatar } from '../Avatar'

/**
 * Меню участника голоса — правый клик (или долгое нажатие, или «⋯») по плитке звонка и по человеку под каналом.
 * Каждому: профиль, написать, громкость и «заглушить для себя», отдельно — звук его демонстрации экрана.
 * Модераторам сверх того — по правам в канале и старшинству ролей (как проверяет сервер):
 * заглушить на сервере, отключить от голоса, выгнать с сервера. На себе — только профиль.
 */
export function VoiceUserMenu() {
  const menu = useVoiceMenu((s) => s.menu)
  const overlay = useUi((s) => s.settings !== null || s.serverSettings !== null)
  const sheet = useIsMobile()

  // Открыли настройки поверх — меню больше не к чему
  useEffect(() => {
    if (overlay) voiceMenu.close()
  }, [overlay])

  if (!menu || overlay) return null
  return createPortal(
    <div className="zoomed vmenu-layer">
      {sheet && <div className="vmenu-backdrop" onClick={() => voiceMenu.close()} aria-hidden="true" />}
      <MenuPop key={menu.seq} menu={menu} sheet={sheet} />
    </div>,
    document.body,
  )
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Что-то пошло не так')

function MenuPop({ menu, sheet }: { menu: VoiceMenuState; sheet: boolean }) {
  const { userId, roomId } = menu
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const meId = useChat((s) => s.me?.id ?? '')
  const user = useChat((s) => s.users[userId])
  const guild = useChat((s) => guildOfChannel(s.guilds, roomId))
  const member = useVoice((s) => s.rooms[roomId]?.find((m) => m.userId === userId))
  const volume = useVoice((s) => s.volumes[userId] ?? 100)
  const muted = useVoice((s) => Boolean(s.localMutes[userId]))
  const screenVolume = useVoice((s) => s.screenVolumes[userId] ?? 100)
  const screenMuted = useVoice((s) => Boolean(s.screenMutes[userId]))
  const isMe = userId === meId
  const name = user?.displayName ?? 'участник'
  // телефон: шторку смахивают вниз, затемнение бледнеет вместе с ней
  useSheetSwipe(popRef, () => voiceMenu.close(), sheet, () => popRef.current?.parentElement?.querySelector<HTMLElement>('.vmenu-backdrop'))

  // Человек вышел из голоса — меню о нём больше не нужно (себя показываем и до подтверждения входа)
  const gone = !isMe && !member
  useEffect(() => {
    if (gone) voiceMenu.close()
  }, [gone])

  // У курсора или у кнопки, но целиком в окне. Координаты окна → CSS-пиксели масштабированного слоя
  useLayoutEffect(() => {
    const el = popRef.current
    if (!el || sheet) return
    const k = uiZoom()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth / k
    const vh = window.innerHeight / k
    const a = menu.anchor
    let left: number
    let top: number
    if (a.kind === 'point') {
      left = a.x / k
      top = a.y / k
      if (left + w > vw - 8) left -= w
      if (top + h > vh - 8) top -= h
    } else {
      left = a.right / k - w
      const below = a.bottom / k + 6
      top = below + h > vh - 8 ? a.top / k - h - 6 : below
    }
    setPos({ left: clamp(left, 8, vw - w - 8), top: clamp(top, 8, vh - h - 8) })
  }, [menu.anchor, sheet, member?.screen, Boolean(guild)])

  // Фокус — на первый пункт (с клавиатуры удобно), на телефоне не нужен
  const placed = pos !== null
  useEffect(() => {
    if (placed && !sheet) popRef.current?.querySelector<HTMLElement>('[data-vi]')?.focus({ preventScroll: true })
  }, [placed, sheet])

  // Закрыть: клик мимо, Esc, прокрутка под меню, смена размера окна, уход из окна
  useEffect(() => {
    const inside = (t: EventTarget | null) => t instanceof Node && Boolean(popRef.current?.contains(t))
    const onDown = (e: PointerEvent) => {
      if (inside(e.target) || (e.target instanceof Element && e.target.closest('.vmenu-backdrop, [data-vmenu-trigger]'))) return
      voiceMenu.close()
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc закрывает только меню, а не окно или полноэкранный режим под ним
      e.preventDefault()
      e.stopPropagation()
      voiceMenu.close()
    }
    // Уехало то, у чего открыто меню (список каналов, сетка плиток), — закрываем.
    // Чужая прокрутка (пришло сообщение в чат под звонком) — не в счёт
    const onScroll = (e: Event) => {
      if (inside(e.target) || sheet) return
      const t = e.target
      if (t instanceof Element && !t.querySelector('.is-menu')) return
      voiceMenu.close()
    }
    const width = window.innerWidth
    // на телефоне высота окна скачет от клавиатуры и панелей браузера — закрываем только при повороте
    const onResize = () => (!sheet || window.innerWidth !== width) && voiceMenu.close()
    const shut = () => voiceMenu.close()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', shut)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', shut)
    }
  }, [sheet])

  // «Точно выгнать?» само сбрасывается
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 3500)
    return () => window.clearTimeout(t)
  }, [armed])

  const openProfile = () => {
    const a = menu.anchor
    voiceMenu.close()
    // карточка профиля встаёт рядом с тем местом, где открывали меню
    useUi.setState({ profile: a.kind === 'point' ? { userId, left: a.x, right: a.x, top: a.y } : { userId, left: a.left, right: a.right, top: a.top } })
  }

  const moderate = async (action: 'mute' | 'unmute' | 'disconnect') => {
    if (busy) return
    setBusy(true)
    const ok = await moderateVoice(userId, action)
    setBusy(false)
    if (ok) voiceMenu.close()
  }

  const kick = async () => {
    if (!guild || busy) return
    if (!armed) return setArmed(true)
    setBusy(true)
    try {
      chat.upsertGuild((await api.kickMember(guild.id, userId)).guild)
      chat.toast({ title: 'Выгнали с сервера', text: `${name} больше не на «${guild.name}» — вернуться сможет только по приглашению` })
      voiceMenu.close()
    } catch (err) {
      chat.toast({ title: 'Не получилось', text: errorText(err) })
      setBusy(false)
      setArmed(false)
    }
  }

  // Модерация — только на сервере и только тем, у кого роль ниже моей (владельца не трогает никто)
  const canMute = Boolean(guild && can(guild, 'MUTE_MEMBERS', roomId))
  const canMove = Boolean(guild && can(guild, 'MOVE_MEMBERS', roomId))
  const canKick = Boolean(guild && can(guild, 'KICK_MEMBERS'))
  const isMod = !isMe && (canMute || canMove || canKick)
  const ranks = Boolean(guild && outranks(guild, userId))

  // ↑/↓ — по пунктам (у ползунков стрелки свои — двигают громкость)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!popRef.current || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const cur = document.activeElement as HTMLElement
    if (cur instanceof HTMLInputElement) return
    const items = [...popRef.current.querySelectorAll<HTMLElement>('button[data-vi]:not(:disabled)')]
    const i = items.indexOf(cur)
    e.preventDefault()
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1) + items.length) % items.length]?.focus()
  }

  const item = (label: ReactNode, icon: ReactNode, onClick: () => void, extra = '', disabled = false) => (
    <button type="button" role="menuitem" data-vi className={`vmenu__item${extra}`} onClick={onClick} disabled={disabled}>
      <span className="truncate">{label}</span>
      {icon}
    </button>
  )

  return (
    <div
      ref={popRef}
      className={`vmenu${sheet ? ' vmenu--sheet' : ''}`}
      role="menu"
      aria-label={`Действия: ${name}`}
      style={sheet ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {sheet && <span className="vmenu__grip" aria-hidden="true" />}
      <div className="vmenu__head">
        {user && <Avatar user={user} size={34} />}
        <span className="vmenu__who">
          <b className="truncate">{isMe ? `${name} (ты)` : name}</b>
          <small className="truncate">
            {user ? `@${user.username}` : ''}
            {member?.serverMuted ? ' · заглушён на сервере' : ''}
          </small>
        </span>
      </div>

      <div className="vmenu__list">
        {item('Профиль', <UserRound size={16} />, openProfile)}
        {!isMe &&
          item('Написать', <MessageCircle size={16} />, () => {
            voiceMenu.close()
            void openDmWith(userId)
          })}
      </div>

      {!isMe && (
        <>
          <div className="vmenu__sep" role="separator" />
          <VolumeRow label="Громкость" value={volume} off={muted} onChange={(v) => setUserVolume(userId, v)} />
          {item(
            'Заглушить для себя',
            muted ? <Check size={16} /> : <VolumeX size={16} />,
            () => toggleLocalMute(userId),
            muted ? ' is-checked' : '',
          )}
        </>
      )}

      {!isMe && member?.screen && (
        <>
          <div className="vmenu__sep" role="separator" />
          <VolumeRow label="Громкость демонстрации" icon={<MonitorUp size={13} />} value={screenVolume} off={screenMuted} onChange={(v) => setScreenVolume(userId, v)} />
          {item(
            'Заглушить демонстрацию',
            screenMuted ? <Check size={16} /> : <Volume2 size={16} />,
            () => toggleScreenMute(userId),
            screenMuted ? ' is-checked' : '',
          )}
        </>
      )}

      {isMod && guild && (
        <>
          <div className="vmenu__sep" role="separator" />
          <div className="vmenu__label">
            <Shield size={12} /> Модерация
          </div>
          {!ranks ? (
            <p className="vmenu__note">{userId === guild.ownerId ? 'Владельца сервера трогать нельзя' : 'Его роль не ниже твоей — модерировать нельзя'}</p>
          ) : (
            <div className="vmenu__list">
              {canMute &&
                member &&
                item(
                  member.serverMuted ? 'Снять заглушение' : 'Заглушить на сервере',
                  member.serverMuted ? <Mic size={16} /> : <MicOff size={16} />,
                  () => void moderate(member.serverMuted ? 'unmute' : 'mute'),
                  '',
                  busy,
                )}
              {canMove && item('Отключить от голоса', <PhoneOff size={16} />, () => void moderate('disconnect'), ' vmenu__item--danger', busy)}
              {canKick &&
                item(
                  busy && armed ? 'Выгоняем…' : armed ? 'Точно выгнать? Нажми ещё раз' : 'Выгнать с сервера',
                  <UserMinus size={16} />,
                  () => void kick(),
                  ` vmenu__item--danger${armed ? ' is-armed' : ''}`,
                  busy,
                )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Ползунок громкости 0…200 % (100 % — как есть) */
function VolumeRow({ label, icon, value, off, onChange }: { label: string; icon?: ReactNode; value: number; off: boolean; onChange: (v: number) => void }) {
  return (
    <label className={`vmenu__vol${off ? ' is-off' : ''}`}>
      <span className="vmenu__vol-top">
        <span>
          {icon}
          {label}
        </span>
        <b>{off ? 'выкл' : `${value}%`}</b>
      </span>
      <input
        className="slider"
        type="range"
        min={0}
        max={200}
        step={5}
        value={value}
        aria-label={label}
        style={{ '--pct': `${value / 2}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}
