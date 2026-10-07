import { Phone, PhoneOff } from 'lucide-react'
import { dmTitle, useChat } from '../../lib/store'
import { acceptCall, declineCall, useVoice } from '../../lib/voice'
import { Avatar } from '../Avatar'

/** Входящий звонок: карточка сверху по центру, рингтон играет движок голоса */
export function IncomingCall() {
  const call = useVoice((s) => s.incoming.find((c) => c.roomId !== s.roomId))
  const caller = useChat((s) => (call ? s.users[call.from] : undefined))
  const title = useChat((s) => {
    const dm = call ? s.dms.find((d) => d.id === call.roomId) : undefined
    return dm?.kind === 'group' ? dmTitle(s, dm) : null
  })
  if (!call) return null

  return (
    <div className="incoming-call glow" role="alertdialog" aria-label="Входящий звонок">
      <div className="incoming-call__avatar">
        <span className="incoming-call__wave" />
        <span className="incoming-call__wave incoming-call__wave--2" />
        {caller && <Avatar user={caller} size={64} />}
      </div>
      <div className="incoming-call__text">
        <span className="incoming-call__label">{title ? `Звонок в «${title}»` : 'Входящий звонок'}</span>
        <b className="truncate">{caller?.displayName ?? 'Кто-то'}</b>
      </div>
      <div className="incoming-call__actions">
        <button className="call-btn call-btn--decline" onClick={() => declineCall(call.roomId)} data-tip="Отклонить" aria-label="Отклонить">
          <PhoneOff size={20} />
        </button>
        <button className="call-btn call-btn--accept" onClick={() => acceptCall(call.roomId)} data-tip="Ответить" aria-label="Ответить">
          <Phone size={20} />
        </button>
      </div>
    </div>
  )
}
