import { useState } from 'react'
import { Volume2 } from 'lucide-react'
import { blip } from '../../lib/fx'
import { setSetting, useSettings } from '../../lib/settings'
import { useChat } from '../../lib/store'
import { Group, SectionHead, Toggle } from './controls'

const supportsDesktop = typeof Notification !== 'undefined'

export function NotificationsSection() {
  const s = useSettings()
  const dnd = useChat((st) => st.me?.status === 'dnd')
  const [permission, setPermission] = useState(supportsDesktop ? Notification.permission : 'denied')

  const toggleDesktop = async (on: boolean) => {
    if (!on) return setSetting('desktop', false)
    if (!supportsDesktop) return
    let p = Notification.permission
    if (p === 'default') p = await Notification.requestPermission()
    setPermission(p)
    setSetting('desktop', p === 'granted')
  }

  return (
    <>
      <SectionHead title="Уведомления" subtitle="Что делать, когда пишут в личку или зовут в друзья." />

      {dnd && <div className="notice">Сейчас стоит статус «Не беспокоить» — пока он включён, звуков и уведомлений не будет совсем.</div>}

      <Group title="В приложении">
        <Toggle label="Звуки" hint="Короткий сигнал при новом сообщении в личке и заявке в друзья" checked={s.sounds} onChange={(v) => setSetting('sounds', v)} />
        <Toggle label="Всплывающие уведомления" hint="Карточки в правом нижнем углу — по клику открывают переписку" checked={s.toasts} onChange={(v) => setSetting('toasts', v)} />
        <div className="set-actions">
          <button className="btn btn--outline btn--sm" onClick={() => void blip(true)}>
            <Volume2 size={15} /> Проверить звук
          </button>
        </div>
      </Group>

      <Group title="На рабочем столе">
        <Toggle
          label="Уведомления Windows"
          hint="Когда вкладка с Nuntius свёрнута или в фоне — придёт системное уведомление"
          checked={s.desktop && permission === 'granted'}
          disabled={!supportsDesktop}
          onChange={(v) => void toggleDesktop(v)}
        />
        {permission === 'denied' && (
          <p className="muted">
            Браузер запретил уведомления для этого сайта. Разреши их: значок слева от адреса → «Уведомления» → «Разрешить», потом включи
            переключатель ещё раз.
          </p>
        )}
      </Group>
    </>
  )
}
