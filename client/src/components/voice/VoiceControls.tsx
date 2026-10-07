import { Headphones, HeadphoneOff, Mic, MicOff, MonitorUp, MonitorOff, PhoneOff, Settings as SettingsIcon, Video, VideoOff } from 'lucide-react'
import { useSettings } from '../../lib/settings'
import { ui } from '../../lib/ui'
import { leaveVoice, toggleCamera, toggleDeafen, toggleMute, toggleScreen, useVoice } from '../../lib/voice'

/** Кнопки звонка: микрофон, звук, камера, экран, настройки, положить трубку */
export function VoiceControls({ compact }: { compact?: boolean }) {
  const muted = useSettings((s) => s.muted)
  const deafened = useSettings((s) => s.deafened)
  const noMic = useVoice((s) => s.noMic)
  const camera = useVoice((s) => Boolean(s.localCamera))
  const screen = useVoice((s) => Boolean(s.localScreen))
  const micOff = muted || deafened || noMic

  return (
    <div className={`vc${compact ? ' vc--compact' : ''}`}>
      <button
        className={`vc__btn${micOff ? ' is-off' : ''}`}
        onClick={toggleMute}
        data-tip={noMic ? 'Нет доступа к микрофону' : micOff ? 'Включить микрофон' : 'Выключить микрофон'}
        aria-pressed={micOff}
      >
        {micOff ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
      <button className={`vc__btn${deafened ? ' is-off' : ''}`} onClick={toggleDeafen} data-tip={deafened ? 'Включить звук' : 'Выключить звук'} aria-pressed={deafened}>
        {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
      </button>
      <button className={`vc__btn${camera ? ' is-on' : ''}`} onClick={() => void toggleCamera()} data-tip={camera ? 'Выключить камеру' : 'Включить камеру'} aria-pressed={camera}>
        {camera ? <Video size={20} /> : <VideoOff size={20} />}
      </button>
      <button
        className={`vc__btn${screen ? ' is-on' : ''}`}
        onClick={() => void toggleScreen()}
        data-tip={screen ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
        aria-pressed={screen}
      >
        {screen ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
      </button>
      {!compact && (
        <button className="vc__btn" onClick={() => ui.openSettings('voice')} data-tip="Настройки голоса">
          <SettingsIcon size={20} />
        </button>
      )}
      <button className="vc__btn vc__btn--leave" onClick={() => leaveVoice()} data-tip="Отключиться">
        <PhoneOff size={20} />
      </button>
    </div>
  )
}
