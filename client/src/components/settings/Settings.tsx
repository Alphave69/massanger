import { useEffect, type ComponentType } from 'react'
import { ArrowLeft, Award, Bell, Crown, FlaskConical, IdCard, LogOut, Mic, Palette, ShieldCheck, UserRound, X } from 'lucide-react'
import { versionClick } from '../../lib/eggs'
import { useIsMobile } from '../../lib/mobile'
import { useSettings } from '../../lib/settings'
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
import { BadgesSection } from './BadgesSection'
import { LabSection } from './LabSection'
import { AdminSection } from './AdminSection'

type NavGroup = { group: string; items: { id: SettingsSection; label: string; icon: ComponentType<{ size?: number }> }[] }

const NAV: NavGroup[] = [
  {
    group: 'Пользователь',
    items: [
      { id: 'account', label: 'Мой аккаунт', icon: UserRound },
      { id: 'profile', label: 'Профиль', icon: IdCard },
      { id: 'badges', label: 'Значки', icon: Award },
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

/** Открывается пасхалкой «Разработчик» */
const LAB: NavGroup = { group: 'Секретное', items: [{ id: 'lab', label: 'Лаборатория', icon: FlaskConical }] }
/** Только для админов приложения */
const ADMIN: NavGroup = { group: 'Nuntius', items: [{ id: 'admin', label: 'Админка', icon: Crown }] }

const SECTIONS: Record<SettingsSection, ComponentType> = {
  account: AccountSection,
  profile: ProfileSection,
  privacy: PrivacySection,
  appearance: AppearanceSection,
  voice: VoiceSection,
  notifications: NotificationsSection,
  badges: BadgesSection,
  lab: LabSection,
  admin: AdminSection,
}

/** Полноэкранные настройки — как в Discord: слева разделы, справа содержимое */
export function Settings({ onLogout }: { onLogout: () => void }) {
  const section = useUi((s) => s.settings)
  const me = useChat((s) => s.me)
  const devMode = useSettings((s) => s.devMode)
  const list = useUi((s) => s.settingsList)
  const mobile = useIsMobile()

  useEffect(() => {
    if (!section) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && ui.closeSettings()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [section])

  if (!section || !me) return null
  // Закрытые разделы без доступа не открываем, даже если попросили
  const allowed = section === 'admin' ? me.admin : section === 'lab' ? devMode : true
  const Content = SECTIONS[allowed ? section : 'account']
  const nav = [...NAV, ...(devMode ? [LAB] : []), ...(me.admin ? [ADMIN] : [])]

  return (
    <div className={`settings zoomed${mobile ? (list ? ' is-list' : ' is-section') : ''}`} role="dialog" aria-modal="true" aria-label="Настройки">
      <nav className="settings__nav">
        <div className="settings__nav-inner">
          {mobile && <MobileTop title="Настройки" onClose={ui.closeSettings} />}
          <button className="settings__me" onClick={() => ui.openSettings('profile')}>
            <Avatar user={me} size={40} status={selfPresence(me.status)} />
            <span className="settings__me-text">
              <span className="truncate">{me.displayName}</span>
              <span className="settings__me-sub">Редактировать профиль</span>
            </span>
          </button>

          {nav.map((g) => (
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
          {/* 7 кликов — режим разработчика (пасхалка) */}
          <div className="settings__version" onClick={versionClick}>
            nuntius · v0.4
          </div>
        </div>
      </nav>

      <main className="settings__content">
        {mobile && <MobileBar back="Настройки" onClose={ui.closeSettings} />}
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

/** Телефон: шапка списка разделов — название и «закрыть» */
export function MobileTop({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="settings__mtop">
      <h2 className="settings__mtitle truncate">{title}</h2>
      <button className="icon-btn settings__mclose" onClick={onClose} aria-label="Закрыть">
        <X size={22} />
      </button>
    </div>
  )
}

/** Телефон: шапка раздела — «← к списку» и «закрыть» */
export function MobileBar({ back, onClose }: { back: string; onClose: () => void }) {
  return (
    <div className="settings__mbar">
      <button className="settings__mback" onClick={ui.settingsBack}>
        <ArrowLeft size={20} />
        <span className="truncate">{back}</span>
      </button>
      <button className="icon-btn settings__mclose" onClick={onClose} aria-label="Закрыть">
        <X size={22} />
      </button>
    </div>
  )
}
