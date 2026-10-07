import { useEffect, type ComponentType } from 'react'
import { Bell, IdCard, LogOut, Mic, Palette, ShieldCheck, UserRound, X } from 'lucide-react'
import { selfPresence } from '../../lib/status'
import { useChat } from '../../lib/store'
import { ui, useUi, type SettingsSection } from '../../lib/ui'
import { Avatar } from '../Avatar'
import { AccountSection } from './AccountSection'
import { ProfileSection } from './ProfileSection'
import { PrivacySection } from './PrivacySection'
import { AppearanceSection } from './AppearanceSection'
import { VoiceSection } from './VoiceSection'
import { NotificationsSection } from './NotificationsSection'

const NAV: { group: string; items: { id: SettingsSection; label: string; icon: ComponentType<{ size?: number }> }[] }[] = [
  {
    group: 'Пользователь',
    items: [
      { id: 'account', label: 'Мой аккаунт', icon: UserRound },
      { id: 'profile', label: 'Профиль', icon: IdCard },
      { id: 'privacy', label: 'Конфиденциальность', icon: ShieldCheck },
    ],
  },
  {
    group: 'Приложение',
    items: [
      { id: 'appearance', label: 'Внешний вид', icon: Palette },
      { id: 'voice', label: 'Голос и звук', icon: Mic },
      { id: 'notifications', label: 'Уведомления', icon: Bell },
    ],
  },
]

const SECTIONS: Record<SettingsSection, ComponentType> = {
  account: AccountSection,
  profile: ProfileSection,
  privacy: PrivacySection,
  appearance: AppearanceSection,
  voice: VoiceSection,
  notifications: NotificationsSection,
}

/** Полноэкранные настройки — как в Discord: слева разделы, справа содержимое */
export function Settings({ onLogout }: { onLogout: () => void }) {
  const section = useUi((s) => s.settings)
  const me = useChat((s) => s.me)

  useEffect(() => {
    if (!section) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.closeSettings()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [section])

  if (!section || !me) return null
  const Content = SECTIONS[section]

  return (
    <div className="settings zoomed" role="dialog" aria-modal="true" aria-label="Настройки">
      <nav className="settings__nav">
        <div className="settings__nav-inner">
          <button className="settings__me" onClick={() => ui.openSettings('profile')}>
            <Avatar user={me} size={40} status={selfPresence(me.status)} />
            <span className="settings__me-text">
              <span className="truncate">{me.displayName}</span>
              <span className="settings__me-sub">Редактировать профиль</span>
            </span>
          </button>

          {NAV.map((g) => (
            <div key={g.group} className="settings__group">
              <div className="settings__group-title">{g.group}</div>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  className={`settings__item${section === item.id ? ' is-active' : ''}`}
                  onClick={() => ui.openSettings(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                >
                  <item.icon size={17} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}

          <div className="settings__sep" />
          <button className="settings__item settings__item--danger" onClick={onLogout}>
            <LogOut size={17} />
            Выйти из аккаунта
          </button>
          <div className="settings__version">nuntius · v0.3</div>
        </div>
      </nav>

      <main className="settings__content">
        <div className="settings__content-inner" key={section}>
          <Content />
        </div>
        <div className="settings__tools">
          <button className="settings__close" onClick={ui.closeSettings} aria-label="Закрыть настройки">
            <span className="settings__close-x">
              <X size={20} />
            </span>
            <span className="settings__close-hint">ESC</span>
          </button>
        </div>
      </main>
    </div>
  )
}
