import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Fullscreen, HeadphoneOff, Lock, Maximize2, MicOff, Minimize2, MonitorUp, MoreHorizontal, Phone, Video, VolumeX } from 'lucide-react'
import type { VoiceMember } from '../../lib/api'
import { plural } from '../../lib/format'
import { can, guildOfChannel } from '../../lib/perms'
import { useIsMobile, useLongPress } from '../../lib/mobile'
import { useChat } from '../../lib/store'
import { clearWatch, joinVoice, toggleCamera, useVoice } from '../../lib/voice'
import { useVoiceMenu, voiceMenu } from '../../lib/voiceMenu'
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
  // Голосовой канал сервера (в личках и группах — undefined): от него зависят права
  const guild = useChat((s) => guildOfChannel(s.guilds, roomId))
  const [focus, setFocus] = useState<string | null>(null)
  /** Плитка, которую развернуть во весь экран, как только она станет крупной (двойной клик) */
  const [fullKey, setFullKey] = useState<string | null>(null)
  // «Смотреть» по метке «в эфире» в списке канала — чью демонстрацию открыть крупно
  const watch = useVoice((s) => (s.watch?.roomId === roomId ? s.watch.userId : null))
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
  /** Чужие демонстрации, которые уже видели: новая выводится крупно сама (если крупно никого нет) */
  const seenScreens = useRef(new Set<string>())
  useEffect(() => {
    const keys = tileKeys.split('|')
    const screens = keys.filter((k) => k.endsWith(':screen') && k !== `${meId}:screen`)
    const fresh = screens.find((k) => !seenScreens.current.has(k))
    seenScreens.current = new Set(screens)
    setFocus((f) => {
      if (f && keys.includes(f)) return f
      // крупная плитка ушла — показываем следующую демонстрацию, если есть; свернул сам — не навязываем
      if (f) return fresh ?? screens[0] ?? null
      return fresh ?? null
    })
  }, [tileKeys, meId])

  // Пришли по метке «в эфире» — его экран крупно (когда мы в комнате и экран есть)
  useEffect(() => {
    if (!watch || !inRoom) return
    const key = `${watch}:screen`
    if (tileKeys.split('|').includes(key)) setFocus(key)
    clearWatch()
  }, [watch, inRoom, tileKeys])

  // Щелчок по крупной плитке сворачивает её не сразу: вдруг это начало двойного щелчка (во весь экран)
  const unfocusTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(unfocusTimer.current), [])
  const toggleFocus = (key: string) => {
    window.clearTimeout(unfocusTimer.current)
    if (focus !== key) return setFocus(key)
    unfocusTimer.current = window.setTimeout(() => setFocus((f) => (f === key ? null : f)), 250)
  }
  const fullscreen = (key: string) => {
    window.clearTimeout(unfocusTimer.current)
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {})
    if (!document.fullscreenEnabled) return setFocus(key)
    setFocus(key)
    setFullKey(key)
  }

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
        {focused && (
          <Tile
            info={focused}
            roomId={roomId}
            focused
            onToggleFocus={() => toggleFocus(focused.key)}
            onUnfocus={() => setFocus(null)}
            onFullscreen={() => fullscreen(focused.key)}
            wantFullscreen={fullKey === focused.key}
            onFullscreenDone={() => setFullKey(null)}
          />
        )}
        <div
          className={focused ? 'stage__strip' : `stage__grid stage__grid--${Math.min(tiles.length, 9)}`}
          style={cols && !focused ? ({ '--cols': cols } as CSSProperties) : undefined}
        >
          {tiles
            .filter((t) => t.key !== focused?.key)
            .map((t) => (
              <Tile key={t.key} info={t} roomId={roomId} onToggleFocus={() => toggleFocus(t.key)} onFullscreen={() => fullscreen(t.key)} />
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
  roomId: string
  focused?: boolean
  /** Щелчок по плитке: крупно ↔ обратно в сетку */
  onToggleFocus: () => void
  /** «Свернуть» кнопкой — сразу */
  onUnfocus?: () => void
  /** Двойной щелчок и кнопка: во весь экран (и обратно) */
  onFullscreen: () => void
  /** Крупная плитка должна развернуться во весь экран (попросили двойным щелчком) */
  wantFullscreen?: boolean
  onFullscreenDone?: () => void
}

/** По кнопкам, ползункам и ссылкам на плитке щелчок не значит «крупно» */
const isControl = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest('button, input, a'))

const PATH_LABEL: Record<string, string> = { direct: 'напрямую', 'relay-udp': 'через сервер', 'relay-tcp': 'через сервер (TCP)' }
const LIMIT_LABEL: Record<string, string> = { bandwidth: 'не хватает интернета', cpu: 'не хватает процессора' }

/**
 * Сколько реально идёт демонстрация: кадры, размер, скорость и путь (напрямую или через наш сервер).
 * Свой экран — по самому медленному зрителю и во что упирается кодировщик
 */
function ScreenStats({ userId, isMe }: { userId: string; isMe: boolean }) {
  const text = useVoice((s) => {
    if (isMe) {
      const outs = Object.values(s.links).filter((l) => l.screenOut)
      if (!outs.length) return null
      const worst = outs.reduce((a, b) => (b.screenOut!.fps < a.screenOut!.fps ? b : a))
      const o = worst.screenOut!
      const relayed = outs.some((l) => l.path?.startsWith('relay'))
      const limit = LIMIT_LABEL[o.limit]
      return `отдаю ${o.fps} к/с · ${o.height}p · ${(o.kbps / 1000).toFixed(1)} Мбит/с${relayed ? ' · через сервер' : ''}${limit ? ` · ${limit}` : ''}`
    }
    const link = s.links[userId]
    const i = link?.screenIn
    if (!i) return null
    return `${i.fps} к/с · ${i.height}p · ${(i.kbps / 1000).toFixed(1)} Мбит/с${link.path ? ` · ${PATH_LABEL[link.path]}` : ''}`
  })
  if (!text) return null
  return <span className="tile__stats">{text}</span>
}

function Tile({ info, roomId, focused, onToggleFocus, onUnfocus, onFullscreen, wantFullscreen, onFullscreenDone }: TileProps) {
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
  // своя камера, переключённая на лету (та же MediaStream с новой дорожкой), — видео надо перезапустить
  const rev = useVoice((s) => (isMe && kind === 'person' ? s.cameraRev : 0))
  const peerState = useVoice((s) => (isMe ? 'connected' : s.peerStates[member.userId]))
  const localMuted = useVoice((s) => Boolean(kind === 'person' ? s.localMutes[member.userId] : s.screenMutes[member.userId]))
  const menuOpen = useVoiceMenu((s) => s.menu?.userId === member.userId && s.menu.roomId === roomId)
  const name = user?.displayName ?? '…'
  const tileRef = useRef<HTMLDivElement>(null)

  // Двойной щелчок по плитке из сетки: она стала крупной — теперь во весь экран (жест пользователя ещё действует)
  useEffect(() => {
    if (!wantFullscreen) return
    onFullscreenDone?.()
    void tileRef.current?.requestFullscreen?.().catch(() => {})
  }, [wantFullscreen, onFullscreenDone])

  // Правый клик и долгое нажатие пальцем — меню человека (громкость, профиль, модерация)
  const openMenu = (x: number, y: number) => voiceMenu.open(member.userId, roomId, { kind: 'point', x, y })
  const press = useLongPress(openMenu)
  /** Во весь экран меню не видно (оно живёт поверх страницы) — сначала выходим, потом открываем */
  const afterFullscreen = (open: () => void) => {
    if (!document.fullscreenElement) return open()
    document.addEventListener('fullscreenchange', () => window.setTimeout(open, 150), { once: true })
    void document.exitFullscreen().catch(() => {})
  }
  const onContextMenu = (e: MouseEvent) => {
    press.cancel()
    e.preventDefault()
    if (press.justFired()) return
    if (!document.fullscreenElement) return openMenu(e.clientX, e.clientY)
    // из полноэкранного — у середины плитки, когда она вернётся на место
    afterFullscreen(() => {
      const r = tileRef.current?.getBoundingClientRect()
      if (r) openMenu(r.left + r.width / 2, r.top + r.height / 2)
    })
  }

  const canFullscreen = document.fullscreenEnabled && (focused || Boolean(stream))
  const toggleFullscreen = () => (document.fullscreenElement ? void document.exitFullscreen().catch(() => {}) : onFullscreen())

  return (
    <div
      ref={tileRef}
      className={`tile${speaking ? ' is-speaking' : ''}${kind === 'screen' ? ' tile--screen' : ''}${focused ? ' tile--focused' : ''}${menuOpen ? ' is-menu' : ''}`}
      data-tile={info.key}
      {...press.handlers}
      onClick={(e) => {
        // второй щелчок двойного — не «крупно/обратно», а во весь экран (это сделает onDoubleClick)
        if (e.detail > 1 || isControl(e.target) || document.fullscreenElement) return
        onToggleFocus()
      }}
      onDoubleClick={(e) => !isControl(e.target) && toggleFullscreen()}
      onContextMenu={onContextMenu}
    >
      {stream ? (
        <VideoView stream={stream} rev={rev} mirrored={isMe && kind === 'person'} contain={kind === 'screen' || Boolean(focused)} />
      ) : (
        <div className="tile__face">
          {user && <Avatar user={user} size={focused ? 112 : 72} />}
          {kind === 'screen' && <span className="tile__wait">Ждём картинку…</span>}
        </div>
      )}
      {kind === 'screen' && stream && <ScreenStats userId={member.userId} isMe={isMe} />}
      {/* чужая демонстрация в сетке — подсказка, что её можно открыть щелчком */}
      {kind === 'screen' && !focused && !isMe && (
        <span className="tile__watch" aria-hidden="true">
          <Maximize2 size={14} /> Смотреть
        </span>
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
        {localMuted && (
          <span className="tile__tag">
            <VolumeX size={12} /> {kind === 'screen' ? 'без звука' : 'заглушён'}
          </span>
        )}
      </div>
      {!isMe && kind === 'person' && peerState && peerState !== 'connected' && (
        <span className="tile__state">{peerState === 'failed' ? 'нет связи' : 'подключаемся…'}</span>
      )}
      <div className="tile__tools">
        {/* то же меню, что по правому клику, — чтобы его было видно */}
        <button
          className={`tile__tool${menuOpen ? ' is-active' : ''}`}
          data-vmenu-trigger
          onClick={(e) => {
            const btn = e.currentTarget
            if (menuOpen) voiceMenu.close()
            else afterFullscreen(() => voiceMenu.openAt(member.userId, roomId, btn))
          }}
          data-tip={isMe ? 'Ещё' : 'Громкость и ещё'}
          aria-label="Действия с участником"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={16} />
        </button>
        {canFullscreen && (
          <button className="tile__tool" onClick={toggleFullscreen} data-tip="Во весь экран" aria-label="Во весь экран">
            <Fullscreen size={15} />
          </button>
        )}
        <button
          className="tile__tool"
          onClick={focused ? onUnfocus : onToggleFocus}
          data-tip={focused ? 'Свернуть' : 'Крупно'}
          aria-label={focused ? 'Свернуть' : 'Крупно'}
        >
          {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </div>
  )
}

function VideoView({ stream, rev = 0, mirrored, contain }: { stream: MediaStream; rev?: number; mirrored: boolean; contain: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    // rev сменился — дорожку в потоке заменили: переподключаем, чтобы видео точно взяло новую
    if (el.srcObject === stream && rev) el.srcObject = null
    if (el.srcObject !== stream) el.srcObject = stream
  }, [stream, rev])
  // Звук идёт через WebAudio, у видео он всегда выключен
  return <video ref={ref} className={`tile__video${mirrored ? ' is-mirrored' : ''}${contain ? ' is-contain' : ''}`} autoPlay playsInline muted />
}
