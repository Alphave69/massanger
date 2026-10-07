import { useEffect, useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import { api, ApiError, setToken, type Privacy } from '../../lib/api'
import { chat, useChat } from '../../lib/store'
import { Choice, Group, SectionHead } from './controls'

export function PrivacySection() {
  const me = useChat((s) => s.me!)

  const savePrivacy = async (patch: Partial<Privacy>) => {
    const before = useChat.getState().me!
    chat.setMe({ ...before, privacy: { ...before.privacy, ...patch } })
    try {
      chat.setMe((await api.updateMe({ privacy: patch })).user)
    } catch (err) {
      chat.setMe(before)
      chat.toast({ title: 'Не сохранилось', text: err instanceof ApiError ? err.message : 'Попробуй ещё раз' })
    }
  }

  return (
    <>
      <SectionHead title="Конфиденциальность" subtitle="Кто может до тебя достучаться и где ты вошёл в аккаунт." />

      <Group title="Личные сообщения">
        <Choice
          value={me.privacy.dms}
          onChange={(dms) => void savePrivacy({ dms })}
          options={[
            { value: 'servers', label: 'Друзья и люди с общих серверов', hint: 'Как в Discord: написать может любой, с кем у тебя общий сервер' },
            { value: 'friends', label: 'Только друзья', hint: 'Остальные увидят, что ты принимаешь сообщения только от друзей' },
          ]}
        />
      </Group>

      <Group title="Заявки в друзья">
        <Choice
          value={me.privacy.friendRequests}
          onChange={(friendRequests) => void savePrivacy({ friendRequests })}
          options={[
            { value: 'everyone', label: 'Все', hint: 'Любой, кто знает твой логин, может отправить заявку' },
            { value: 'nobody', label: 'Никто', hint: 'Заявки не приходят — но ты сам можешь добавлять людей' },
          ]}
        />
      </Group>

      <Group title="Невидимка">
        <p className="muted">
          Хочешь быть в сети незаметно — выбери статус «Невидимка» (клик по своему имени внизу слева). Для всех ты будешь «не в сети», но
          сообщения будут приходить как обычно.
        </p>
      </Group>

      <Group title="Сеансы" danger>
        <LogoutEverywhere />
      </Group>
    </>
  )
}

function LogoutEverywhere() {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const run = async () => {
    if (!confirm) {
      setConfirm(true)
      timer.current = window.setTimeout(() => setConfirm(false), 3500)
      return
    }
    setBusy(true)
    try {
      const { token } = await api.logoutAll()
      setToken(token)
      chat.toast({ title: 'Готово', text: 'Все остальные устройства вышли из аккаунта' })
    } catch (err) {
      chat.toast({ title: 'Ошибка', text: err instanceof ApiError ? err.message : 'Попробуй ещё раз' })
    }
    setBusy(false)
    setConfirm(false)
  }

  return (
    <div className="set-actions">
      <button className={`btn ${confirm ? 'btn--primary' : 'btn--outline'}`} onClick={() => void run()} disabled={busy}>
        <LogOut size={16} /> {confirm ? 'Точно? Нажми ещё раз' : 'Выйти на всех устройствах'}
      </button>
      <span className="muted">Это устройство останется в аккаунте. Пригодится, если входил с чужого компьютера.</span>
    </div>
  )
}
