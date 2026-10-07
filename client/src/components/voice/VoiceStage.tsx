import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { HeadphoneOff, Maximize2, MicOff, Minimize2, MonitorUp, Phone, SlidersHorizontal, Video } from 'lucide-react'
import type { VoiceMember } from '../../lib/api'
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
          <h3>{members.length ? `Здесь уже ${members.length} ${plural(members.length)}` : 'В канале пока пусто'}</h3>
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
        <div className={focused ? 'stage__strip' : `stage__grid stage__grid--${Math.min(tiles.length, 9)}`}>
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

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'человек' : 'человека')

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

  return (
    <div className={`tile${speaking ? ' is-speaking' : ''}${kind === 'screen' ? ' tile--screen' : ''}${focused ? ' tile--focused' : ''}`}>
      {stream ? (
        <VideoView stream={stream} mirrored={isMe && kind === 'person'} contain={kind === 'screen'} />
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
  const [open, setOpen] = useState(false)
  const volume = useVoice((s) => s.volumes[userId] ?? 100)
  const muted = useVoice((s) => Boolean(s.localMutes[userId]))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div className="volume-menu" ref={ref}>
      <button className="tile__tool" onClick={() => setOpen((v) => !v)} data-tip="Громкость">
        <SlidersHorizontal size={15} />
      </button>
      {open && (
        <div className="volume-menu__pop">
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
            style={{ '--pct': `${volume / 2}%` } as CSSProperties}
            onChange={(e) => setUserVolume(userId, Number(e.target.value))}
          />
          <button className={`volume-menu__mute${muted ? ' is-on' : ''}`} onClick={() => toggleLocalMute(userId)}>
            {muted ? 'Включить звук для себя' : 'Заглушить для себя'}
          </button>
        </div>
      )}
    </div>
  )
}
