import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Fullscreen, HeadphoneOff, Lock, Maximize2, Mic, MicOff, Minimize2, MonitorUp, Phone, PhoneOff, Shield, SlidersHorizontal, Video } from 'lucide-react'
import type { Guild, VoiceMember } from '../../lib/api'
import { plural } from '../../lib/format'
import { can, guildOfChannel, outranks } from '../../lib/perms'
import { useIsMobile } from '../../lib/mobile'
import { uiZoom } from '../../lib/settings'
import { useChat } from '../../lib/store'
import { joinVoice, moderateVoice, setUserVolume, toggleCamera, toggleLocalMute, useVoice } from '../../lib/voice'
import { Avatar } from '../Avatar'
import { Popover } from '../guild/Popover'
import { VoiceControls } from './VoiceControls'

const EMPTY: VoiceMember[] = []

interface TileInfo {
  key: string
  member: VoiceMember
  kind: 'person' | 'screen'
}

/**
 * «Сцена» звонка: плитки участников (аватар или видео, свечение у говорящего), демонстрации экрана,
 * управление. variant=channel — на весь экран голосового канала, call — над перепиской в личке/группе.
 */
export function VoiceStage({ roomId, variant }: { roomId: string; variant: 'channel' | 'call' }) {
  const members = useVoice((s) => s.rooms[roomId] ?? EMPTY)
  const myRoom = useVoice((s) => s.roomId)
  const status = useVoice((s) => s.status)
  const calling = useVoice((s) => s.calling === roomId)
  const meId = useChat((s) => s.me!.id)
  // Голосовой канал сервера (в личках и группах — undefined): от него зависят права
  const guild = useChat((s) => guildOfChannel(s.guilds, roomId))
  const [focus, setFocus] = useState<string | null>(null)
  const inRoom = myRoom === roomId
  const mobile = useIsMobile()

  // Пока сервер не подтвердил вход — показываем себя заранее
  const list = inRoom && !members.some((m) => m.userId === meId) ? [...members, placeholder(meId)] : members
  const tiles: TileInfo[] = list.flatMap((m) => [
    { key: `${m.userId}:person`, member: m, kind: 'person' as const },
    ...(m.screen ? [{ key: `${m.userId}:screen`, member: m, kind: 'screen' as const }] : []),
  ])
  const focused = tiles.find((t) => t.key === focus)
  const gridCount = tiles.length - (focused ? 1 : 0)
  // Звонок в личке — сцена низкая и широкая: до трёх плиток в ряд, дальше — в два ряда
  // На телефоне экран узкий — не больше двух в ряд
  const cols = variant === 'call' ? (mobile ? Math.min(Math.max(gridCount, 1), 2) : gridCount <= 3 ? Math.max(gridCount, 1) : Math.ceil(gridCount / 2)) : undefined

  const tileKeys = tiles.map((t) => t.key).join('|')
  const screenKey = tiles.find((t) => t.kind === 'screen')?.key ?? null
  useEffect(() => {
    // Демонстрацию экрана сразу выводим крупно; ушедший участник — снимаем «крупно»
    setFocus((f) => (f && tileKeys.split('|').includes(f) ? f : screenKey))
  }, [tileKeys, screenKey])

  if (!inRoom && variant === 'channel') {
    const canConnect = !guild || can(guild, 'CONNECT', roomId)
    const canVideo = !guild || can(guild, 'VIDEO', roomId)
    return (
      <div className="stage stage--lobby">
        <div className="stage__lobby">
          <div className="stage__avatars">
            {members.slice(0, 6).map((m) => (
              <LobbyAvatar key={m.userId} userId={m.userId} />
            ))}
          </div>
          <h3>{members.length ? `Здесь уже ${plural(members.length, ['человек', 'человека', 'человек'])}` : 'В канале пока пусто'}</h3>
          <p>{members.length ? 'Заходи — тебя услышат сразу.' : 'Зайди первым — друзья увидят, что ты тут.'}</p>
          <div className="stage__lobby-actions">
            <button className="btn btn--primary" onClick={() => void joinVoice(roomId)} disabled={!canConnect}>
              <Phone size={16} /> Присоединиться
            </button>
            {/* у .btn обрезается всё, что торчит, — подсказку вешаем на обёртку */}
            <span className="stage__lobby-tip" {...(canConnect && !canVideo ? { 'data-tip': 'Нет прав на видео в этом канале' } : null)}>
              <button
                className="btn btn--outline"
                disabled={!canConnect || !canVideo}
                onClick={async () => {
                  await joinVoice(roomId)
                  if (useVoice.getState().roomId === roomId) void toggleCamera()
                }}
              >
                <Video size={16} /> С камерой
              </button>
            </span>
          </div>
          {!canConnect && (
            <p className="stage__denied">
              <Lock size={14} /> У тебя нет права подключаться к этому каналу — можно только смотреть, кто здесь.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={`stage stage--${variant}${focused ? ' has-focus' : ''}`}>
      {status === 'connecting' && inRoom && <div className="stage__status">Подключаемся…</div>}
      {calling && <div className="stage__status stage__status--calling">Звоним…</div>}
      <div className="stage__tiles">
        {focused && <Tile info={focused} guild={guild} roomId={roomId} focused onToggleFocus={() => setFocus(null)} />}
        <div
          className={focused ? 'stage__strip' : `stage__grid stage__grid--${Math.min(tiles.length, 9)}`}
          style={cols && !focused ? ({ '--cols': cols } as CSSProperties) : undefined}
        >
          {tiles
            .filter((t) => t.key !== focused?.key)
            .map((t) => (
              <Tile key={t.key} info={t} guild={guild} roomId={roomId} onToggleFocus={() => setFocus(t.key)} />
            ))}
        </div>
      </div>
      {inRoom && <VoiceControls compact={variant === 'call'} />}
    </div>
  )
}

const placeholder = (userId: string): VoiceMember => ({
  userId,
  muted: false,
  deafened: false,
  serverMuted: false,
  video: false,
  screen: false,
  cameraStream: null,
  screenStream: null,
  joinedAt: 0,
})

function LobbyAvatar({ userId }: { userId: string }) {
  const user = useChat((s) => s.users[userId])
  return user ? <Avatar user={user} size={56} /> : null
}

interface TileProps {
  info: TileInfo
  /** Сервер голосового канала (в личке — undefined) */
  guild: Guild | undefined
  roomId: string
  focused?: boolean
  onToggleFocus: () => void
}

function Tile({ info, guild, roomId, focused, onToggleFocus }: TileProps) {
  const { member, kind } = info
  const meId = useChat((s) => s.me!.id)
  const isMe = member.userId === meId
  const user = useChat((s) => s.users[member.userId])
  const speaking = useVoice((s) => kind === 'person' && Boolean(s.speaking[member.userId]))
  const stream = useVoice((s) => {
    if (kind === 'screen') return isMe ? s.localScreen : (s.remoteStreams[member.screenStream ?? ''] ?? null)
    if (!member.video) return null
    return isMe ? s.localCamera : (s.remoteStreams[member.cameraStream ?? ''] ?? null)
  })
  const peerState = useVoice((s) => (isMe ? 'connected' : s.peerStates[member.userId]))
  const localMuted = useVoice((s) => Boolean(s.localMutes[member.userId]))
  const name = user?.displayName ?? '…'
  const tileRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={tileRef} className={`tile${speaking ? ' is-speaking' : ''}${kind === 'screen' ? ' tile--screen' : ''}${focused ? ' tile--focused' : ''}`}>
      {stream ? (
        <VideoView stream={stream} mirrored={isMe && kind === 'person'} contain={kind === 'screen' || Boolean(focused)} />
      ) : (
        <div className="tile__face">
          {user && <Avatar user={user} size={focused ? 112 : 72} />}
          {kind === 'screen' && <span className="tile__wait">Ждём картинку…</span>}
        </div>
      )}
      <div className="tile__label">
        {kind === 'screen' && <MonitorUp size={14} />}
        <span className="truncate">{kind === 'screen' ? `Экран · ${name}` : isMe ? `${name} (ты)` : name}</span>
        {kind === 'person' && member.serverMuted && (
          <span className="tile__srv" data-tip="Заглушён на сервере">
            <MicOff size={14} />
          </span>
        )}
        {kind === 'person' && member.muted && !member.serverMuted && <MicOff size={14} />}
        {kind === 'person' && member.deafened && <HeadphoneOff size={14} />}
        {kind === 'person' && localMuted && <span className="tile__tag">заглушён</span>}
      </div>
      {!isMe && kind === 'person' && peerState && peerState !== 'connected' && (
        <span className="tile__state">{peerState === 'failed' ? 'нет связи' : 'подключаемся…'}</span>
      )}
      <div className="tile__tools">
        {!isMe && kind === 'person' && guild && <ModMenu guild={guild} roomId={roomId} member={member} />}
        {!isMe && kind === 'person' && <VolumeMenu userId={member.userId} />}
        {focused && document.fullscreenEnabled && (
          <button
            className="tile__tool"
            onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void tileRef.current?.requestFullscreen().catch(() => {}))}
            data-tip="Во весь экран"
            aria-label="Во весь экран"
          >
            <Fullscreen size={15} />
          </button>
        )}
        <button className="tile__tool" onClick={onToggleFocus} data-tip={focused ? 'Свернуть' : 'Крупно'}>
          {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </div>
  )
}

/** Модерация на сервере: заглушить для всех / отключить от голоса — по правам в канале и старшинству ролей */
function ModMenu({ guild, roomId, member }: { guild: Guild; roomId: string; member: VoiceMember }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const name = useChat((s) => s.users[member.userId]?.displayName ?? 'участник')
  const canMute = can(guild, 'MUTE_MEMBERS', roomId)
  const canMove = can(guild, 'MOVE_MEMBERS', roomId)
  if ((!canMute && !canMove) || !outranks(guild, member.userId)) return null

  const act = async (action: 'mute' | 'unmute' | 'disconnect') => {
    setBusy(true)
    const ok = await moderateVoice(member.userId, action)
    setBusy(false)
    if (ok) setOpen(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        className={`tile__tool${member.serverMuted ? ' is-server' : ''}`}
        onClick={() => setOpen((v) => !v)}
        data-tip="Модерация"
        aria-label="Модерация"
        aria-expanded={open}
      >
        <Shield size={15} />
      </button>
      {open && (
        <Popover anchorRef={btnRef} onClose={() => setOpen(false)} align="end" className="mod-menu">
          <div className="mod-menu__title">
            <Shield size={13} /> <span className="truncate">{name}</span>
          </div>
          {canMute && (
            <button className="mod-menu__item" disabled={busy} onClick={() => void act(member.serverMuted ? 'unmute' : 'mute')}>
              {member.serverMuted ? <Mic size={15} /> : <MicOff size={15} />}
              <span>
                <b>{member.serverMuted ? 'Снять заглушение' : 'Заглушить на сервере'}</b>
                <small>{member.serverMuted ? 'Сможет снова говорить' : 'Не сможет говорить, пока не снимут'}</small>
              </span>
            </button>
          )}
          {canMove && (
            <button className="mod-menu__item mod-menu__item--danger" disabled={busy} onClick={() => void act('disconnect')}>
              <PhoneOff size={15} />
              <span>
                <b>Отключить от голоса</b>
                <small>Сможет зайти снова</small>
              </span>
            </button>
          )}
        </Popover>
      )}
    </>
  )
}

function VideoView({ stream, mirrored, contain }: { stream: MediaStream; mirrored: boolean; contain: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream
  }, [stream])
  // Звук идёт через WebAudio, у видео он всегда выключен
  return <video ref={ref} className={`tile__video${mirrored ? ' is-mirrored' : ''}${contain ? ' is-contain' : ''}`} autoPlay playsInline muted />
}

/** Громкость человека «для себя» и «заглушить для себя» */
function VolumeMenu({ userId }: { userId: string }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const volume = useVoice((s) => s.volumes[userId] ?? 100)
  const muted = useVoice((s) => Boolean(s.localMutes[userId]))
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!anchor) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setAnchor(null)
    }
    const shut = () => setAnchor(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && shut()
    window.addEventListener('pointerdown', close)
    window.addEventListener('resize', shut)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('resize', shut)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor])

  // Меню рисуем поверх всего (плитки обрезают своё содержимое) — у кнопки, но в пределах окна
  useLayoutEffect(() => {
    if (!anchor || !popRef.current) return setPos(null)
    const k = uiZoom()
    const w = popRef.current.offsetWidth
    const h = popRef.current.offsetHeight
    const vw = window.innerWidth / k
    const vh = window.innerHeight / k
    const left = Math.min(Math.max(8, anchor.right / k - w), vw - w - 8)
    const below = anchor.bottom / k + 6
    const top = below + h > vh - 8 ? Math.max(8, anchor.top / k - h - 6) : below
    setPos({ left, top })
  }, [anchor])

  return (
    <div className="volume-menu">
      <button
        ref={btnRef}
        className="tile__tool"
        onClick={() => setAnchor((a) => (a ? null : (btnRef.current?.getBoundingClientRect() ?? null)))}
        data-tip="Громкость"
        aria-label="Громкость"
        aria-expanded={Boolean(anchor)}
      >
        <SlidersHorizontal size={15} />
      </button>
      {anchor &&
        createPortal(
          <div className="zoomed volume-layer">
            <div
              ref={popRef}
              className="volume-menu__pop"
              style={{ left: pos?.left ?? -9999, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            >
              <div className="volume-menu__row">
                <span>Громкость</span>
                <b>{volume}%</b>
              </div>
              <input
                className="slider"
                type="range"
                min={0}
                max={200}
                step={5}
                value={volume}
                aria-label="Громкость"
                style={{ '--pct': `${volume / 2}%` } as CSSProperties}
                onChange={(e) => setUserVolume(userId, Number(e.target.value))}
              />
              <button className={`volume-menu__mute${muted ? ' is-on' : ''}`} onClick={() => toggleLocalMute(userId)}>
                {muted ? 'Включить звук для себя' : 'Заглушить для себя'}
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
