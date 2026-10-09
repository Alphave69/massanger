import { MonitorUp, PhoneOff, Video } from 'lucide-react'
import { describeRoom, openRoom } from '../../lib/rooms'
import { useChat } from '../../lib/store'
import { leaveVoice, toggleCamera, toggleScreen, useVoice } from '../../lib/voice'

/** Показ экрана: телефоны (iPhone, Android) так не умеют — там кнопку не показываем */
const canShare = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'

/** Плашка «Голос подключён» над своей панелью — видна, где бы ты ни был в приложении */
export function VoicePanel() {
  const roomId = useVoice((s) => s.roomId)
  const status = useVoice((s) => s.status)
  const ping = useVoice((s) => s.ping)
  const camera = useVoice((s) => Boolean(s.localCamera))
  const screen = useVoice((s) => Boolean(s.localScreen))
  // подписка на чат нужна, чтобы название обновлялось при переименовании
  useChat((s) => s.guilds)
  useChat((s) => s.dms)
  if (!roomId) return null
  const where = describeRoom(roomId)
  const quality = ping === null ? 'unknown' : ping < 120 ? 'good' : ping < 300 ? 'ok' : 'bad'
  // немного юмора на крайних значениях
  const pingTip =
    ping === null ? 'Пинг измеряется…' : ping <= 5 ? `Пинг ${ping} мс · ⚡ скорость света` : ping >= 400 ? `Пинг ${ping} мс · 🐢 черепашья почта` : `Пинг ${ping} мс`

  return (
    <div className={`voice-panel voice-panel--${status}`}>
      <div className="voice-panel__top">
        <span className={`signal signal--${quality}`} data-tip={pingTip}>
          <i />
          <i />
          <i />
        </span>
        <div className="voice-panel__text">
          <b>{status === 'connected' ? 'Голос подключён' : 'Подключаемся…'}</b>
          <button className="voice-panel__where truncate" onClick={() => openRoom(roomId)}>
            {where ? `${where.title} · ${where.subtitle}` : 'Звонок'}
          </button>
        </div>
        <button className="icon-btn voice-panel__leave" onClick={() => leaveVoice()} data-tip="Отключиться" aria-label="Отключиться">
          <PhoneOff size={18} />
        </button>
      </div>
      <div className={`voice-panel__actions${canShare ? '' : ' voice-panel__actions--one'}`}>
        <button className={`voice-panel__btn${camera ? ' is-on' : ''}`} onClick={() => void toggleCamera()}>
          <Video size={16} /> Камера
        </button>
        {canShare && (
          <button className={`voice-panel__btn${screen ? ' is-on' : ''}`} onClick={() => void toggleScreen()}>
            <MonitorUp size={16} /> Экран
          </button>
        )}
      </div>
    </div>
  )
}
