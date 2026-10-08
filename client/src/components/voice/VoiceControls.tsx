import { Headphones, HeadphoneOff, Lock, Mic, MicOff, MonitorUp, MonitorOff, PhoneOff, Settings as SettingsIcon, Video, VideoOff } from 'lucide-react'
import { can, guildOfChannel } from '../../lib/perms'
import { useSettings } from '../../lib/settings'
import { chat, useChat } from '../../lib/store'
import { ui } from '../../lib/ui'
import { leaveVoice, selfServerMuted, toggleCamera, toggleDeafen, toggleMute, toggleScreen, useVoice } from '../../lib/voice'

const NO_VIDEO = 'Нет прав на видео в этом канале'

/** Кнопки звонка: микрофон, звук, камера, экран, настройки, положить трубку */
export function VoiceControls({ compact }: { compact?: boolean }) {
  const muted = useSettings((s) => s.muted)
  const deafened = useSettings((s) => s.deafened)
  const noMic = useVoice((s) => s.noMic)
  const camera = useVoice((s) => Boolean(s.localCamera))
  const screen = useVoice((s) => Boolean(s.localScreen))
  const roomId = useVoice((s) => s.roomId)
  const serverMuted = useVoice((s) => selfServerMuted(s))
  const guild = useChat((s) => guildOfChannel(s.guilds, roomId))
  // В голосовом канале сервера камера и экран — только с правом VIDEO (выключить можно всегда)
  const videoOk = !guild || can(guild, 'VIDEO', roomId ?? undefined)
  const canSpeak = !guild || can(guild, 'SPEAK', roomId ?? undefined)
  const micOff = muted || deafened || noMic || serverMuted

  const micTip = serverMuted
    ? canSpeak
      ? 'Модератор заглушил тебя на сервере'
      : 'В этом канале нельзя говорить'
    : noMic
      ? 'Нет доступа к микрофону'
      : micOff
        ? 'Включить микрофон'
        : 'Выключить микрофон'

  const onMic = () => {
    if (!serverMuted) return toggleMute()
    chat.toast({
      title: 'Микрофон заблокирован',
      text: canSpeak ? 'Тебя заглушил модератор — включить микрофон сможет только он' : 'В этом канале у тебя нет права говорить — можно только слушать',
    })
  }

  return (
    <div className={`vc${compact ? ' vc--compact' : ''}`}>
      <button className={`vc__btn${micOff ? ' is-off' : ''}${serverMuted ? ' is-locked' : ''}`} onClick={onMic} data-tip={micTip} aria-pressed={micOff}>
        {micOff ? <MicOff size={20} /> : <Mic size={20} />}
        {serverMuted && (
          <span className="vc__lock">
            <Lock size={10} strokeWidth={3} />
          </span>
        )}
      </button>
      <button className={`vc__btn${deafened ? ' is-off' : ''}`} onClick={toggleDeafen} data-tip={deafened ? 'Включить звук' : 'Выключить звук'} aria-pressed={deafened}>
        {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
      </button>
      <button
        className={`vc__btn${camera ? ' is-on' : ''}`}
        onClick={() => void toggleCamera()}
        disabled={!camera && !videoOk}
        data-tip={!camera && !videoOk ? NO_VIDEO : camera ? 'Выключить камеру' : 'Включить камеру'}
        aria-pressed={camera}
      >
        {camera ? <Video size={20} /> : <VideoOff size={20} />}
      </button>
      <button
        className={`vc__btn${screen ? ' is-on' : ''}`}
        onClick={() => void toggleScreen()}
        disabled={!screen && !videoOk}
        data-tip={!screen && !videoOk ? NO_VIDEO : screen ? 'Остановить демонстрацию' : 'Демонстрация экрана'}
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
