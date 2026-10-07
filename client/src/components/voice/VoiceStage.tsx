import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Fullscreen, HeadphoneOff, Maximize2, MicOff, Minimize2, MonitorUp, Phone, SlidersHorizontal, Video } from 'lucide-react'
import type { VoiceMember } from '../../lib/api'
import { plural } from '../../lib/format'
import { uiZoom } from '../../lib/settings'
import { useChat } from '../../lib/store'
import { joinVoice, setUserVolume, toggleCamera, toggleLocalMute, useVoice } from '../../lib/voice'
import { Avatar } from '../Avatar'
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
  const [focus, setFocus] = useState<string | null>(null)
  const inRoom = myRoom === roomId

  // Пока сервер не подтвердил вход — показываем себя заранее
  const list = inRoom && !members.some((m) => m.userId === meId) ? [...members, placeholder(meId)] : members
  const tiles: TileInfo[] = list.flatMap((m) => [
    { key: `${m.userId}:person`, member: m, kind: 'person' as const },
    ...(m.screen ? [{ key: `${m.userId}:screen`, member: m, kind: 'screen' as const }] : []),
  ])
  const focused = tiles.find((t) => t.key === focus)
  const gridCount = tiles.length - (focused ? 1 : 0)
  // Звонок в личке — сцена низкая и широкая: до трёх плиток в ряд, дальше — в два ряда
  const cols = variant === 'call' ? (gridCount <= 3 ? Math.max(gridCount, 1) : Math.ceil(gridCount / 2)) : undefined

  const tileKeys = tiles.map((t) => t.key).join('|')
  const screenKey = tiles.find((t) => t.kind === 'screen')?.key ?? null
  useEffect(() => {
    // Демонстрацию экрана сразу выводим крупно; ушедший участник — снимаем «крупно»
    setFocus((f) => (f && tileKeys.split('|').includes(f) ? f : screenKey))
  }, [tileKeys, screenKey])

  if (!inRoom && variant === 'channel') {
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
            <button className="btn btn--primary" onClick={() => void joinVoice(roomId)}>
              <Phone size={16} /> Присоединиться
            </button>
            <button
              className="btn btn--outline"
              onClick={async () => {
                await joinVoice(roomId)
                void toggleCamera()
              }}
            >
              <Video size={16} /> С камерой
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`stage stage--${variant}${focused ? ' has-focus' : ''}`}>
      {status === 'connecting' && inRoom && <div className="stage__status">Подключаемся…</div>}
      {calling && <div className="stage__status stage__status--calling">Звоним…</div>}
      <div className="stage__tiles">
        {focused && <Tile info={focused} focused onToggleFocus={() => setFocus(null)} />}
        <div
          className={focused ? 'stage__strip' : `stage__grid stage__grid--${Math.min(tiles.length, 9)}`}
          style={cols && !focused ? ({ '--cols': cols } as CSSProperties) : undefined}
        >
          {tiles
            .filter((t) => t.key !== focused?.key)
            .map((t) => (
              <Tile key={t.key} info={t} onToggleFocus={() => setFocus(t.key)} />
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

function Tile({ info, focused, onToggleFocus }: { info: TileInfo; focused?: boolean; onToggleFocus: () => void }) {
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
        {kind === 'person' && member.muted && <MicOff size={14} />}
        {kind === 'person' && member.deafened && <HeadphoneOff size={14} />}
        {kind === 'person' && localMuted && <span className="tile__tag">заглушён</span>}
      </div>
      {!isMe && kind === 'person' && peerState && peerState !== 'connected' && (
        <span className="tile__state">{peerState === 'failed' ? 'нет связи' : 'подключаемся…'}</span>
      )}
      <div className="tile__tools">
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
